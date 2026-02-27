/**
 * Device Service
 * PostgreSQL for persistence, Redis for WS authorization & Enrollment
 */

const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const { prisma } = require('../lib/prisma');
const redis = require('../lib/redis'); // Exports getRedis(), etc.
const { generateToken, verifyToken } = require('../utils/jwt.util');
const config = require('../config/config');

// Enrollment constants
// In-memory storage for WebSocket connections only (not serializable)
const deviceConnections = new Map();

// ═══════════════════════════════════════════════════════════════════
// Device CRUD Operations (PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

async function registerDevice(deviceData, userId) {
    const { deviceId, platform, appVersion } = deviceData;

    // Strict validation
    if (!deviceId) {
        const error = new Error('deviceId is required');
        error.code = 'MISSING_DEVICE_ID';
        throw error;
    }

    // Upsert device
    const device = await prisma.device.upsert({
        where: { deviceId },
        update: {
            platform: platform || 'android',
            appVersion: appVersion || '1.0.0',
            lastSeenAt: new Date()
        },
        create: {
            deviceId,
            userId, // Link to user (legacy)
            platform: platform || 'android',
            appVersion: appVersion || '1.0.0',
            lastSeenAt: new Date()
        }
    });

    return device;
}

async function getDevice(deviceId) {
    return prisma.device.findUnique({
        where: { deviceId },
        include: {
            user: { select: { username: true, role: true } },
            assignedRoute: { select: { id: true, name: true } }
        }
    });
}

async function getAllDevices() {
    return prisma.device.findMany({
        include: { user: { select: { username: true } } },
        orderBy: { lastSeenAt: 'desc' }
    });
}

async function getDevicesByUser(userId) {
    return prisma.device.findMany({
        where: { userId },
        orderBy: { lastSeenAt: 'desc' }
    });
}

async function updateDevice(deviceId, updateData) {
    try {
        return await prisma.device.update({
            where: { deviceId },
            data: { ...updateData, lastSeenAt: new Date() }
        });
    } catch (error) {
        if (error.code === 'P2025') return null;
        throw error;
    }
}

async function deleteDevice(deviceId) {
    try {
        await redis.deleteWsAuth(deviceId);
        await redis.deleteWsConnection(deviceId);
        deviceConnections.delete(deviceId);

        await prisma.$transaction([
            prisma.stream.deleteMany({ where: { deviceId } }),
            prisma.auditLog.deleteMany({ where: { deviceId } }),
            prisma.deviceCredential.deleteMany({ where: { deviceId } }),
            prisma.device.delete({ where: { deviceId } })
        ]);

        return true;
    } catch (error) {
        if (error.code === 'P2025') return false;
        throw error;
    }
}

async function deviceExists(deviceId) {
    const count = await prisma.device.count({ where: { deviceId } });
    return count > 0;
}

async function assignRouteToDevice(deviceId, routeId) {
    return prisma.device.update({
        where: { deviceId },
        data: { assignedRouteId: routeId }
    });
}

// ═══════════════════════════════════════════════════════════════════
// Device Enrollment (Redis-based)
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate enrollment code and store in Redis
 */
async function createEnrollment(adminUser, options = {}) {
    const { label, requestedDeviceId } = options;
    const redisClient = redis.getRedis();

    // 1. Rate Limiting
    const rateKey = `rate:enroll:${adminUser.userId}`;
    const currentRate = await redisClient.incr(rateKey);
    if (currentRate === 1) {
        await redisClient.expire(rateKey, 60);
    }
    if (currentRate > (process.env.ENROLL_RATE_LIMIT_PER_MIN || 10)) {
        throw new Error('Rate limit exceeded for enrollment generation');
    }

    // 2. Generate 6-digit Code
    let code;
    let attempts = 0;
    while (attempts < 3) {
        code = Math.floor(100000 + Math.random() * 900000).toString();
        const existing = await redisClient.exists(`enroll:${code}`);
        if (!existing) break;
        attempts++;
    }
    if (attempts >= 3) throw new Error('Failed to generate unique enrollment code');

    // 3. Store in Redis
    const enrollData = {
        label,
        requestedDeviceId,
        userId: adminUser.userId,
        createdBy: adminUser.userId, // kept for backward compatibility if any active enrollments use it
        createdAt: new Date().toISOString()
    };

    // TTL: 10 minutes (default)
    const ttl = process.env.ENROLL_TTL_SECONDS || 600;
    const key = `enroll:${code}`;

    await redisClient.set(key, JSON.stringify(enrollData), 'EX', ttl);

    console.log(`[Enrollment] Created code=${code} ttl=${ttl}s for user=${adminUser.userId}`);

    return {
        enrollmentCode: code,
        expiresAt: new Date(Date.now() + ttl * 1000),
        requestedDeviceId,
        serverBaseUrl: process.env.BASE_URL || `http://localhost:${config.PORT || 4000}`
    };
}

/**
 * Confirm enrollment: Validate code, create device, return JWT
 */
async function confirmEnrollment(code, payload) {
    const redisClient = redis.getRedis();

    // Normalize code: trim, remove spaces
    const normalizedCode = (code || '').toString().replace(/\s+/g, '');
    const key = `enroll:${normalizedCode}`;

    // 1. Validate Code in Redis
    const dataStr = await redisClient.get(key);
    const ttl = await redisClient.ttl(key);

    console.log(`[Enrollment] Attempt: code=${normalizedCode} redisKeyExists=${!!dataStr} ttl=${ttl}`);

    if (!dataStr) {
        const err = new Error('Invalid or expired enrollment code');
        err.code = 'INVALID_CODE';
        throw err;
    }
    const enrollData = JSON.parse(dataStr);

    // 2. Determine Device ID
    let deviceId = enrollData.requestedDeviceId;
    if (!deviceId && payload.deviceInfo?.androidId) {
        // Deterministic ID from Android ID
        deviceId = `android-${payload.deviceInfo.androidId}`;
    }
    if (!deviceId) {
        // Fallback to random UUID prefix + epoch
        deviceId = `android-${uuidv4().split('-')[0]}-${Math.floor(Date.now() / 1000)}`;
    }

    // 3. Determine ownerUserId (fallback to admin if not in enrollment)
    let ownerUserId = enrollData.userId || enrollData.createdBy;

    if (!ownerUserId) {
        const passwordHash = await bcrypt.hash(config.DEFAULT_ADMIN_PASSWORD || 'admin123', 10);
        const admin = await prisma.user.upsert({
            where: { username: 'admin' },
            update: {},
            create: {
                username: 'admin',
                role: 'ADMIN',
                passwordHash
            }
        });
        ownerUserId = admin.id;
    }

    // 4. Upsert Device in DB
    // Build data objects dynamically so we never pass `undefined` to Prisma
    // (passing undefined for an unknown field causes "Unknown argument" even on valid schemas
    //  if the generated Prisma Client is stale — this is defensive and correct either way)
    const updateData = {
        platform: payload.platform || 'android',
        appVersion: payload.appVersion || '1.0.0',
        lastSeenAt: new Date()
    };
    if (enrollData.label) {
        updateData.label = enrollData.label;
    }

    const createData = {
        deviceId,
        platform: payload.platform || 'android',
        appVersion: payload.appVersion || '1.0.0',
        lastSeenAt: new Date(),
        label: enrollData.label || 'Enrolled Device',
        user: { connect: { id: ownerUserId } }
    };

    let device;
    try {
        device = await prisma.device.upsert({
            where: { deviceId },
            update: updateData,
            create: createData
        });
    } catch (dbErr) {
        console.error(`[Enrollment] DB error for device=${deviceId}:`, dbErr.message);
        // Re-throw as a DB-level error (not an INVALID_CODE) so controller returns 500
        const err = new Error('Database error during enrollment. Please retry.');
        err.code = 'DB_ERROR';
        throw err;
    }

    // 5. Generate JWT for the device
    const token = generateToken({
        role: 'device',
        deviceId: device.deviceId,
        sub: device.deviceId
    });

    // 6. Cleanup Redis ONLY after successful DB upsert
    await redisClient.del(key);
    console.log(`[Enrollment] Success: code=${normalizedCode} claimed by device=${deviceId}`);

    return {
        deviceId: device.deviceId,
        token,
        expiresIn: config.JWT_EXPIRES_IN || '7d',
        baseUrl: process.env.BASE_URL || `http://localhost:${config.PORT || 4000}`
    };
}

/**
 * Verify device token (Stateless JWT)
 */
function verifyDeviceToken(token) {
    try {
        const decoded = verifyToken(token);
        if (decoded.role !== 'device' || !decoded.deviceId) {
            return null;
        }
        return decoded; // contains { role, deviceId, ... }
    } catch (err) {
        return null;
    }
}

async function cleanupStaleDevices(olderThanSeconds) {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000);

    const staleDevices = await prisma.device.findMany({
        where: {
            lastSeenAt: { lt: cutoff },
            streams: {
                none: {
                    status: { in: ['STARTED', 'PAUSED'] }
                }
            }
        },
        select: { deviceId: true }
    });

    const deviceIds = staleDevices.map(d => d.deviceId);

    if (deviceIds.length > 0) {
        await prisma.$transaction([
            prisma.stream.deleteMany({ where: { deviceId: { in: deviceIds } } }),
            prisma.auditLog.deleteMany({ where: { deviceId: { in: deviceIds } } }),
            prisma.deviceCredential.deleteMany({ where: { deviceId: { in: deviceIds } } }),
            prisma.device.deleteMany({ where: { deviceId: { in: deviceIds } } })
        ]);
    }

    return deviceIds.length;
}

// ═══════════════════════════════════════════════════════════════════
// WebSocket Authorization (Redis)
// ═══════════════════════════════════════════════════════════════════

async function authorizeDeviceForWS(deviceId, userId, token) {
    await redis.setWsAuth(deviceId, userId, token);
}

async function isDeviceAuthorizedForWS(deviceId, token) {
    const auth = await redis.getWsAuth(deviceId);
    if (!auth) return false;
    return auth.token === token;
}

async function getWsAuthorization(deviceId) {
    return redis.getWsAuth(deviceId);
}

async function refreshWsAuthorization(deviceId) {
    await redis.refreshWsAuth(deviceId);
}

// ═══════════════════════════════════════════════════════════════════
// WebSocket Connection Management
// ═══════════════════════════════════════════════════════════════════

async function setDeviceConnection(deviceId, ws) {
    deviceConnections.set(deviceId, ws);
    await redis.setWsConnection(deviceId, process.env.HOSTNAME || 'local');
    await updateDevice(deviceId, { isConnected: true });
}

function getDeviceConnection(deviceId) {
    return deviceConnections.get(deviceId) || null;
}

async function removeDeviceConnection(deviceId) {
    deviceConnections.delete(deviceId);
    await redis.deleteWsConnection(deviceId);
    await updateDevice(deviceId, { isConnected: false });
}

async function refreshDeviceConnection(deviceId) {
    await redis.refreshWsConnection(deviceId);
    await updateDevice(deviceId, {});
}

function getConnectedDeviceIds() {
    return Array.from(deviceConnections.keys());
}

module.exports = {
    registerDevice,
    getDevice,
    getAllDevices,
    getDevicesByUser,
    updateDevice,
    deleteDevice,
    deviceExists,
    assignRouteToDevice,
    // Enrollment
    createEnrollment,
    confirmEnrollment,
    verifyDeviceToken,
    cleanupStaleDevices,
    // WS Auth
    authorizeDeviceForWS,
    isDeviceAuthorizedForWS,
    getWsAuthorization,
    refreshWsAuthorization,
    // WS Conn
    setDeviceConnection,
    getDeviceConnection,
    removeDeviceConnection,
    refreshDeviceConnection,
    getConnectedDeviceIds
};
