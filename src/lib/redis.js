/**
 * Redis Client & Utilities
 * Handles real-time state: WS auth, WS presence, stream state
 */

const Redis = require('ioredis');
const config = require('../config/config');

// Redis client instance
let redis = null;

/**
 * Initialize Redis connection
 */
function createRedisClient() {
    const redisUrl = config.REDIS_URL || 'redis://localhost:6379';

    redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        lazyConnect: true,
    });

    redis.on('connect', () => {
        console.log('✅ Connected to Redis');
    });

    redis.on('error', (error) => {
        console.error('❌ Redis error:', error.message);
    });

    redis.on('close', () => {
        console.log('🔌 Redis connection closed');
    });

    return redis;
}

/**
 * Connect to Redis with retry logic
 */
async function connectRedis(maxRetries = 5, delayMs = 3000) {
    if (!redis) {
        createRedisClient();
    }

    let retries = 0;

    while (retries < maxRetries) {
        try {
            await redis.connect();
            return true;
        } catch (error) {
            // Already connected is fine
            if (error.message.includes('already')) {
                return true;
            }

            retries++;
            console.error(`❌ Redis connection failed (attempt ${retries}/${maxRetries}):`, error.message);

            if (retries < maxRetries) {
                console.log(`⏳ Retrying in ${delayMs / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    throw new Error('Failed to connect to Redis after maximum retries');
}

/**
 * Disconnect from Redis
 */
async function disconnectRedis() {
    if (redis) {
        await redis.quit();
        console.log('🔌 Disconnected from Redis');
    }
}

/**
 * Get Redis client instance
 */
function getRedis() {
    if (!redis) {
        createRedisClient();
    }
    return redis;
}

// ═══════════════════════════════════════════════════════════════════
// WebSocket Authorization (ws:auth:<deviceId>)
// TTL: 15 minutes
// ═══════════════════════════════════════════════════════════════════

const WS_AUTH_PREFIX = 'ws:auth:';
const WS_AUTH_TTL = config.WS_AUTH_TTL || 900; // 15 minutes

/**
 * Authorize device for WebSocket connection
 * @param {string} deviceId 
 * @param {string} userId 
 * @param {string} token 
 */
async function setWsAuth(deviceId, userId, token) {
    const key = WS_AUTH_PREFIX + deviceId;
    const value = JSON.stringify({
        userId,
        token,
        authorizedAt: Date.now()
    });

    await getRedis().setex(key, WS_AUTH_TTL, value);
}

/**
 * Get WebSocket authorization for device
 * @param {string} deviceId 
 * @returns {Object|null}
 */
async function getWsAuth(deviceId) {
    const key = WS_AUTH_PREFIX + deviceId;
    const value = await getRedis().get(key);

    if (!value) return null;

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/**
 * Delete WebSocket authorization for device
 * @param {string} deviceId 
 */
async function deleteWsAuth(deviceId) {
    const key = WS_AUTH_PREFIX + deviceId;
    await getRedis().del(key);
}

/**
 * Refresh WebSocket authorization TTL
 * @param {string} deviceId 
 */
async function refreshWsAuth(deviceId) {
    const key = WS_AUTH_PREFIX + deviceId;
    await getRedis().expire(key, WS_AUTH_TTL);
}

// ═══════════════════════════════════════════════════════════════════
// WebSocket Connection Presence (ws:conn:<deviceId>)
// TTL: 2 minutes (refreshed on ping)
// ═══════════════════════════════════════════════════════════════════

const WS_CONN_PREFIX = 'ws:conn:';
const WS_CONN_TTL = config.WS_CONN_TTL || 120; // 2 minutes

/**
 * Set WebSocket connection presence
 * @param {string} deviceId 
 * @param {string} serverId 
 */
async function setWsConnection(deviceId, serverId = 'local') {
    const key = WS_CONN_PREFIX + deviceId;
    const value = JSON.stringify({
        serverId,
        connectedAt: Date.now()
    });

    await getRedis().setex(key, WS_CONN_TTL, value);
}

/**
 * Refresh WebSocket connection TTL (called on ping/pong)
 * @param {string} deviceId 
 */
async function refreshWsConnection(deviceId) {
    const key = WS_CONN_PREFIX + deviceId;
    await getRedis().expire(key, WS_CONN_TTL);
}

/**
 * Get WebSocket connection info
 * @param {string} deviceId 
 * @returns {Object|null}
 */
async function getWsConnection(deviceId) {
    const key = WS_CONN_PREFIX + deviceId;
    const value = await getRedis().get(key);

    if (!value) return null;

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/**
 * Delete WebSocket connection presence
 * @param {string} deviceId 
 */
async function deleteWsConnection(deviceId) {
    const key = WS_CONN_PREFIX + deviceId;
    await getRedis().del(key);
}

// ═══════════════════════════════════════════════════════════════════
// Stream State (stream:<deviceId>)
// Hot state for active streams
// ═══════════════════════════════════════════════════════════════════

const STREAM_PREFIX = 'stream:';

/**
 * Set stream state for device
 * @param {string} deviceId 
 * @param {Object} state 
 */
async function setStreamState(deviceId, state) {
    const key = STREAM_PREFIX + deviceId;
    const value = JSON.stringify({
        ...state,
        updatedAt: Date.now()
    });

    // No TTL - managed by stream lifecycle
    await getRedis().set(key, value);
}

/**
 * Get stream state for device
 * @param {string} deviceId 
 * @returns {Object|null}
 */
async function getStreamState(deviceId) {
    const key = STREAM_PREFIX + deviceId;
    const value = await getRedis().get(key);

    if (!value) return null;

    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/**
 * Update specific fields in stream state
 * @param {string} deviceId 
 * @param {Object} updates 
 */
async function updateStreamState(deviceId, updates) {
    const current = await getStreamState(deviceId);
    if (!current) return null;

    const updated = {
        ...current,
        ...updates,
        updatedAt: Date.now()
    };

    await setStreamState(deviceId, updated);
    return updated;
}

/**
 * Delete stream state for device
 * @param {string} deviceId 
 */
async function deleteStreamState(deviceId) {
    const key = STREAM_PREFIX + deviceId;
    await getRedis().del(key);
}

module.exports = {
    // Connection management
    connectRedis,
    disconnectRedis,
    getRedis,

    // WS Authorization
    setWsAuth,
    getWsAuth,
    deleteWsAuth,
    refreshWsAuth,

    // WS Connection Presence
    setWsConnection,
    refreshWsConnection,
    getWsConnection,
    deleteWsConnection,

    // Stream State
    setStreamState,
    getStreamState,
    updateStreamState,
    deleteStreamState
};
