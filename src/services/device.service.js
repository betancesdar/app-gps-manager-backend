/**
 * Device Service
 * PostgreSQL for persistence, Redis for WS authorization
 * In-memory Map only for WebSocket connections (not serializable)
 */

const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../lib/prisma');
const redis = require('../lib/redis');

// In-memory storage for WebSocket connections only
// Map<deviceId, WebSocket>
const deviceConnections = new Map();

// ═══════════════════════════════════════════════════════════════════
// Device CRUD Operations (PostgreSQL)
// ═══════════════════════════════════════════════════════════════════

/**
 * Register or update a device
 * @param {Object} deviceData - Device registration data
 * @param {string} userId - User ID from JWT
 * @returns {Object} Registered/updated device
 */
async function registerDevice(deviceData, userId) {
    const { deviceId, platform, appVersion } = deviceData;
    const finalDeviceId = deviceId || uuidv4();

    // Upsert device in PostgreSQL
    const device = await prisma.device.upsert({
        where: { deviceId: finalDeviceId },
        update: {
            platform: platform || 'android',
            appVersion: appVersion || '1.0.0',
            lastSeenAt: new Date()
        },
        create: {
            deviceId: finalDeviceId,
            userId,
            platform: platform || 'android',
            appVersion: appVersion || '1.0.0'
        }
    });

    return device;
}

/**
 * Get device by deviceId
 * @param {string} deviceId 
 * @returns {Object|null} Device or null
 */
async function getDevice(deviceId) {
    return prisma.device.findUnique({
        where: { deviceId },
        include: {
            user: {
                select: { username: true, role: true }
            }
        }
    });
}

/**
 * Get all devices
 * @returns {Array} List of devices
 */
async function getAllDevices() {
    return prisma.device.findMany({
        include: {
            user: {
                select: { username: true }
            }
        },
        orderBy: { lastSeenAt: 'desc' }
    });
}

/**
 * Get devices for a specific user
 * @param {string} userId 
 * @returns {Array}
 */
async function getDevicesByUser(userId) {
    return prisma.device.findMany({
        where: { userId },
        orderBy: { lastSeenAt: 'desc' }
    });
}

/**
 * Update device info
 * @param {string} deviceId 
 * @param {Object} updateData 
 * @returns {Object|null} Updated device or null
 */
async function updateDevice(deviceId, updateData) {
    try {
        return await prisma.device.update({
            where: { deviceId },
            data: {
                ...updateData,
                lastSeenAt: new Date()
            }
        });
    } catch (error) {
        // Device not found
        if (error.code === 'P2025') return null;
        throw error;
    }
}

/**
 * Delete device
 * @param {string} deviceId 
 * @returns {boolean} Success
 */
async function deleteDevice(deviceId) {
    try {
        // Also remove from Redis and in-memory
        await redis.deleteWsAuth(deviceId);
        await redis.deleteWsConnection(deviceId);
        deviceConnections.delete(deviceId);

        await prisma.device.delete({
            where: { deviceId }
        });
        return true;
    } catch (error) {
        if (error.code === 'P2025') return false;
        throw error;
    }
}

/**
 * Check if device exists
 * @param {string} deviceId 
 * @returns {boolean}
 */
async function deviceExists(deviceId) {
    const count = await prisma.device.count({
        where: { deviceId }
    });
    return count > 0;
}

// ═══════════════════════════════════════════════════════════════════
// WebSocket Authorization (Redis)
// ═══════════════════════════════════════════════════════════════════

/**
 * Authorize a device for WebSocket connection
 * Stores authorization in Redis with TTL
 * @param {string} deviceId 
 * @param {string} userId 
 * @param {string} token 
 */
async function authorizeDeviceForWS(deviceId, userId, token) {
    await redis.setWsAuth(deviceId, userId, token);
}

/**
 * Check if device is authorized for WebSocket
 * @param {string} deviceId 
 * @param {string} token 
 * @returns {boolean}
 */
async function isDeviceAuthorizedForWS(deviceId, token) {
    const auth = await redis.getWsAuth(deviceId);
    if (!auth) return false;
    return auth.token === token;
}

/**
 * Get WS authorization info
 * @param {string} deviceId 
 * @returns {Object|null}
 */
async function getWsAuthorization(deviceId) {
    return redis.getWsAuth(deviceId);
}

/**
 * Refresh WS authorization TTL
 * @param {string} deviceId 
 */
async function refreshWsAuthorization(deviceId) {
    await redis.refreshWsAuth(deviceId);
}

// ═══════════════════════════════════════════════════════════════════
// WebSocket Connection Management (In-Memory + Redis Presence)
// ═══════════════════════════════════════════════════════════════════

/**
 * Associate a WebSocket connection with a device
 * @param {string} deviceId 
 * @param {WebSocket} ws 
 */
async function setDeviceConnection(deviceId, ws) {
    // Store WS reference in memory (not serializable)
    deviceConnections.set(deviceId, ws);

    // Set presence in Redis
    await redis.setWsConnection(deviceId, process.env.HOSTNAME || 'local');

    // Update PostgreSQL
    await updateDevice(deviceId, { isConnected: true });
}

/**
 * Get WebSocket connection for a device
 * @param {string} deviceId 
 * @returns {WebSocket|null}
 */
function getDeviceConnection(deviceId) {
    return deviceConnections.get(deviceId) || null;
}

/**
 * Remove WebSocket connection for a device
 * @param {string} deviceId 
 */
async function removeDeviceConnection(deviceId) {
    deviceConnections.delete(deviceId);

    // Remove presence from Redis
    await redis.deleteWsConnection(deviceId);

    // Update PostgreSQL
    await updateDevice(deviceId, { isConnected: false });
}

/**
 * Refresh WS connection TTL (called on ping)
 * @param {string} deviceId 
 */
async function refreshDeviceConnection(deviceId) {
    await redis.refreshWsConnection(deviceId);
    await updateDevice(deviceId, {}); // Just updates lastSeenAt
}

/**
 * Get all connected device IDs
 * @returns {Array<string>}
 */
function getConnectedDeviceIds() {
    return Array.from(deviceConnections.keys());
}

module.exports = {
    // Device CRUD
    registerDevice,
    getDevice,
    getAllDevices,
    getDevicesByUser,
    updateDevice,
    deleteDevice,
    deviceExists,

    // WS Authorization
    authorizeDeviceForWS,
    isDeviceAuthorizedForWS,
    getWsAuthorization,
    refreshWsAuthorization,

    // WS Connections
    setDeviceConnection,
    getDeviceConnection,
    removeDeviceConnection,
    refreshDeviceConnection,
    getConnectedDeviceIds
};
