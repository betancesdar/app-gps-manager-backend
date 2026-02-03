/**
 * Stream Service
 * Manages coordinate streaming PER DEVICE
 * PostgreSQL for history, Redis for hot state
 * Map<deviceId, StreamInstance> for active intervals
 */

const { prisma } = require('../lib/prisma');
const redis = require('../lib/redis');
const { calculateBearing } = require('../utils/gpx.parser');
const deviceService = require('./device.service');
const routeService = require('./route.service');
const config = require('../config/config');

// Active streams per device (intervals, not serializable)
// Map<deviceId, StreamInstance>
const activeStreams = new Map();

/**
 * StreamInstance class
 * Tracks streaming state for a single device
 */
class StreamInstance {
    constructor(deviceId, routeId, points, streamConfig) {
        this.deviceId = deviceId;
        this.routeId = routeId;
        this.points = points;
        this.config = { ...streamConfig };
        this.currentIndex = 0;
        this.status = 'idle';
        this.intervalId = null;
        this.startedAt = null;
        this.lastEmitAt = null;
    }
}

/**
 * Start streaming coordinates to a device
 * @param {string} deviceId 
 * @param {string} routeId 
 * @param {Object} options - Override config options
 * @returns {Object} Stream info
 */
async function startStream(deviceId, routeId, options = {}) {
    // Validate device is connected
    const ws = deviceService.getDeviceConnection(deviceId);
    if (!ws) {
        throw new Error('Device not connected via WebSocket');
    }

    // Get route from PostgreSQL
    const route = await routeService.getRoute(routeId);
    if (!route) {
        throw new Error('Route not found');
    }

    // Stop any existing stream for this device
    if (activeStreams.has(deviceId)) {
        await stopStream(deviceId);
    }

    // Create stream config
    const streamConfig = {
        speed: options.speed || route.config?.speed || config.STREAM_DEFAULTS.speed,
        accuracy: options.accuracy || route.config?.accuracy || config.STREAM_DEFAULTS.accuracy,
        intervalMs: options.intervalMs || route.config?.intervalMs || config.STREAM_DEFAULTS.intervalMs,
        loop: options.loop !== undefined ? options.loop : (route.config?.loop || config.STREAM_DEFAULTS.loop)
    };

    // Create stream instance
    const stream = new StreamInstance(deviceId, routeId, route.points, streamConfig);
    stream.status = 'running';
    stream.startedAt = new Date().toISOString();

    // Save to PostgreSQL
    const dbStream = await prisma.stream.create({
        data: {
            deviceId,
            routeId,
            status: 'STARTED',
            speed: streamConfig.speed,
            loop: streamConfig.loop
        }
    });
    stream.dbId = dbStream.id;

    // Save hot state to Redis
    await redis.setStreamState(deviceId, {
        streamId: dbStream.id,
        routeId,
        status: 'running',
        currentIndex: 0,
        totalPoints: route.points.length,
        speed: streamConfig.speed,
        loop: streamConfig.loop
    });

    // Start emitting coordinates
    stream.intervalId = setInterval(() => {
        emitNextCoordinate(deviceId);
    }, streamConfig.intervalMs);

    // Emit first coordinate immediately
    emitNextCoordinate(deviceId);

    activeStreams.set(deviceId, stream);

    return {
        streamId: dbStream.id,
        deviceId,
        routeId,
        status: stream.status,
        totalPoints: stream.points.length,
        config: stream.config
    };
}

/**
 * Emit the next coordinate to the device
 * @param {string} deviceId 
 */
async function emitNextCoordinate(deviceId) {
    const stream = activeStreams.get(deviceId);
    if (!stream || stream.status !== 'running') return;

    const ws = deviceService.getDeviceConnection(deviceId);
    if (!ws || ws.readyState !== 1) {
        await pauseStream(deviceId);
        return;
    }

    const currentPoint = stream.points[stream.currentIndex];
    const nextPoint = stream.points[stream.currentIndex + 1] || stream.points[0];

    // Calculate bearing
    const bearing = calculateBearing(currentPoint, nextPoint);

    // Build MOCK_LOCATION message
    const message = {
        type: 'MOCK_LOCATION',
        payload: {
            lat: currentPoint.lat,
            lng: currentPoint.lng,
            speed: stream.config.speed,
            bearing: bearing,
            accuracy: stream.config.accuracy
        },
        meta: {
            pointIndex: stream.currentIndex,
            totalPoints: stream.points.length,
            routeId: stream.routeId,
            timestamp: new Date().toISOString()
        }
    };

    try {
        ws.send(JSON.stringify(message));
        stream.lastEmitAt = new Date().toISOString();

        // Update Redis state
        await redis.updateStreamState(deviceId, {
            currentIndex: stream.currentIndex
        });
    } catch (error) {
        console.error(`Failed to send to device ${deviceId}:`, error.message);
        await pauseStream(deviceId);
        return;
    }

    // Move to next point
    stream.currentIndex++;

    // Check if reached end
    if (stream.currentIndex >= stream.points.length) {
        if (stream.config.loop) {
            stream.currentIndex = 0;
        } else {
            await stopStream(deviceId);
        }
    }
}

/**
 * Pause streaming for a device
 * @param {string} deviceId 
 * @returns {Object|null}
 */
async function pauseStream(deviceId) {
    const stream = activeStreams.get(deviceId);
    if (!stream) return null;

    if (stream.intervalId) {
        clearInterval(stream.intervalId);
        stream.intervalId = null;
    }

    stream.status = 'paused';

    // Update PostgreSQL
    if (stream.dbId) {
        await prisma.stream.update({
            where: { id: stream.dbId },
            data: { status: 'PAUSED' }
        });
    }

    // Update Redis
    await redis.updateStreamState(deviceId, { status: 'paused' });

    return {
        deviceId,
        status: stream.status,
        currentIndex: stream.currentIndex,
        totalPoints: stream.points.length
    };
}

/**
 * Resume streaming for a device
 * @param {string} deviceId 
 * @returns {Object|null}
 */
async function resumeStream(deviceId) {
    const stream = activeStreams.get(deviceId);
    if (!stream || stream.status !== 'paused') return null;

    stream.status = 'running';

    // Update PostgreSQL
    if (stream.dbId) {
        await prisma.stream.update({
            where: { id: stream.dbId },
            data: { status: 'STARTED' }
        });
    }

    // Update Redis
    await redis.updateStreamState(deviceId, { status: 'running' });

    stream.intervalId = setInterval(() => {
        emitNextCoordinate(deviceId);
    }, stream.config.intervalMs);

    // Emit immediately
    emitNextCoordinate(deviceId);

    return {
        deviceId,
        status: stream.status,
        currentIndex: stream.currentIndex,
        totalPoints: stream.points.length
    };
}

/**
 * Stop streaming for a device
 * @param {string} deviceId 
 * @returns {Object|null}
 */
async function stopStream(deviceId) {
    const stream = activeStreams.get(deviceId);
    if (!stream) return null;

    if (stream.intervalId) {
        clearInterval(stream.intervalId);
    }

    // Update PostgreSQL
    if (stream.dbId) {
        await prisma.stream.update({
            where: { id: stream.dbId },
            data: {
                status: 'STOPPED',
                stoppedAt: new Date()
            }
        });
    }

    // Delete Redis state
    await redis.deleteStreamState(deviceId);

    const result = {
        deviceId,
        status: 'stopped',
        finalIndex: stream.currentIndex,
        totalPoints: stream.points.length
    };

    activeStreams.delete(deviceId);

    return result;
}

/**
 * Get stream status for a device
 * @param {string} deviceId 
 * @returns {Object|null}
 */
async function getStreamStatus(deviceId) {
    // First check in-memory
    const stream = activeStreams.get(deviceId);
    if (stream) {
        return {
            deviceId,
            routeId: stream.routeId,
            status: stream.status,
            currentIndex: stream.currentIndex,
            totalPoints: stream.points.length,
            config: stream.config,
            startedAt: stream.startedAt,
            lastEmitAt: stream.lastEmitAt
        };
    }

    // Check Redis for hot state
    const redisState = await redis.getStreamState(deviceId);
    if (redisState) {
        return {
            deviceId,
            routeId: redisState.routeId,
            status: redisState.status,
            currentIndex: redisState.currentIndex,
            totalPoints: redisState.totalPoints,
            fromRedis: true
        };
    }

    return null;
}

/**
 * Get all active streams
 * @returns {Array}
 */
function getAllStreams() {
    const streams = [];
    activeStreams.forEach((stream, deviceId) => {
        streams.push({
            deviceId,
            routeId: stream.routeId,
            status: stream.status,
            currentIndex: stream.currentIndex,
            totalPoints: stream.points.length
        });
    });
    return streams;
}

/**
 * Check if device has active stream
 * @param {string} deviceId 
 * @returns {boolean}
 */
function hasActiveStream(deviceId) {
    return activeStreams.has(deviceId);
}

/**
 * Get stream history for a device from PostgreSQL
 * @param {string} deviceId 
 * @param {number} limit 
 * @returns {Array}
 */
async function getStreamHistory(deviceId, limit = 10) {
    return prisma.stream.findMany({
        where: { deviceId },
        orderBy: { startedAt: 'desc' },
        take: limit,
        include: {
            route: {
                select: { name: true }
            }
        }
    });
}

module.exports = {
    startStream,
    pauseStream,
    resumeStream,
    stopStream,
    getStreamStatus,
    getAllStreams,
    hasActiveStream,
    getStreamHistory
};
