/**
 * Audit Log Service
 * Records all important actions in PostgreSQL
 */

const { prisma } = require('../lib/prisma');

/**
 * Log an action to the audit trail
 * @param {string} action - Action name (e.g., 'LOGIN', 'DEVICE_REGISTER', 'STREAM_START')
 * @param {Object} options - Additional options
 * @param {string} options.userId - User ID (optional)
 * @param {string} options.deviceId - Device ID (optional)
 * @param {Object} options.meta - Additional metadata (optional)
 */
async function log(action, { userId = null, deviceId = null, meta = null } = {}) {
    try {
        await prisma.auditLog.create({
            data: {
                action,
                userId,
                deviceId,
                meta
            }
        });
    } catch (error) {
        // Don't fail the main operation if audit logging fails
        console.error('⚠️ Audit log failed:', error.message);
    }
}

/**
 * Get audit logs with filtering
 * @param {Object} options 
 * @returns {Array}
 */
async function getLogs({
    userId = null,
    deviceId = null,
    action = null,
    limit = 100,
    offset = 0
} = {}) {
    const where = {};

    if (userId) where.userId = userId;
    if (deviceId) where.deviceId = deviceId;
    if (action) where.action = action;

    return prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
            user: {
                select: { username: true }
            }
        }
    });
}

/**
 * Get recent logs for a specific device
 * @param {string} deviceId 
 * @param {number} limit 
 * @returns {Array}
 */
async function getDeviceLogs(deviceId, limit = 50) {
    return prisma.auditLog.findMany({
        where: { deviceId },
        orderBy: { createdAt: 'desc' },
        take: limit
    });
}

/**
 * Get recent logs for a specific user
 * @param {string} userId 
 * @param {number} limit 
 * @returns {Array}
 */
async function getUserLogs(userId, limit = 50) {
    return prisma.auditLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit
    });
}

// Action constants for consistency
const ACTIONS = {
    // Auth
    LOGIN_SUCCESS: 'LOGIN_SUCCESS',
    LOGIN_FAILED: 'LOGIN_FAILED',

    // Devices
    DEVICE_REGISTER: 'DEVICE_REGISTER',
    DEVICE_UPDATE: 'DEVICE_UPDATE',
    DEVICE_DELETE: 'DEVICE_DELETE',

    // WebSocket
    WS_CONNECT: 'WS_CONNECT',
    WS_DISCONNECT: 'WS_DISCONNECT',
    WS_AUTH_FAIL: 'WS_AUTH_FAIL',

    // Routes
    ROUTE_CREATE: 'ROUTE_CREATE',
    ROUTE_DELETE: 'ROUTE_DELETE',

    // Streams
    STREAM_START: 'STREAM_START',
    STREAM_PAUSE: 'STREAM_PAUSE',
    STREAM_RESUME: 'STREAM_RESUME',
    STREAM_STOP: 'STREAM_STOP',
    STREAM_WAITING_START: 'STREAM_WAITING_START',
    STREAM_WAITING_TICK: 'STREAM_WAITING_TICK',
    STREAM_WAITING_SKIP: 'STREAM_WAITING_SKIP',
    STREAM_WAITING_EXTEND: 'STREAM_WAITING_EXTEND'
};

module.exports = {
    log,
    getLogs,
    getDeviceLogs,
    getUserLogs,
    ACTIONS
};
