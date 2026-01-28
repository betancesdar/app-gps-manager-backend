/**
 * Stream Service
 * Manages coordinate streaming PER DEVICE
 * Map<deviceId, StreamInstance>
 */

const { calculateBearing, calculateDistance } = require('../utils/gpx.parser');
const deviceService = require('./device.service');
const routeService = require('./route.service');
const config = require('../config/config');

// Active streams per device
// Map<deviceId, StreamInstance>
const activeStreams = new Map();

/**
 * StreamInstance class
 * Tracks streaming state for a single device
 */
class StreamInstance {
    constructor(deviceId, routeId, route) {
        this.deviceId = deviceId;
        this.routeId = routeId;
        this.points = route.points;
        this.config = { ...route.config };
        this.currentIndex = 0;
        this.status = 'idle'; // idle, running, paused, stopped
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
function startStream(deviceId, routeId, options = {}) {
    // Validate device exists and is connected
    const ws = deviceService.getDeviceConnection(deviceId);
    if (!ws) {
        throw new Error('Device not connected via WebSocket');
    }

    // Get route
    const route = routeService.getRoute(routeId);
    if (!route) {
        throw new Error('Route not found');
    }

    // Stop any existing stream for this device
    if (activeStreams.has(deviceId)) {
        stopStream(deviceId);
    }

    // Create new stream instance
    const stream = new StreamInstance(deviceId, routeId, route);

    // Apply option overrides
    if (options.speed) stream.config.speed = options.speed;
    if (options.accuracy) stream.config.accuracy = options.accuracy;
    if (options.loop !== undefined) stream.config.loop = options.loop;
    if (options.intervalMs) stream.config.intervalMs = options.intervalMs;

    stream.status = 'running';
    stream.startedAt = new Date().toISOString();

    // Start emitting coordinates
    stream.intervalId = setInterval(() => {
        emitNextCoordinate(deviceId);
    }, stream.config.intervalMs);

    // Emit first coordinate immediately
    emitNextCoordinate(deviceId);

    activeStreams.set(deviceId, stream);

    return {
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
function emitNextCoordinate(deviceId) {
    const stream = activeStreams.get(deviceId);
    if (!stream || stream.status !== 'running') return;

    const ws = deviceService.getDeviceConnection(deviceId);
    if (!ws || ws.readyState !== 1) { // 1 = OPEN
        pauseStream(deviceId);
        return;
    }

    const currentPoint = stream.points[stream.currentIndex];
    const nextPoint = stream.points[stream.currentIndex + 1] || stream.points[0];

    // Calculate bearing (direction of movement)
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
    } catch (error) {
        console.error(`Failed to send to device ${deviceId}:`, error.message);
        pauseStream(deviceId);
        return;
    }

    // Move to next point
    stream.currentIndex++;

    // Check if reached end
    if (stream.currentIndex >= stream.points.length) {
        if (stream.config.loop) {
            // Reset to beginning
            stream.currentIndex = 0;
        } else {
            // Stop streaming
            stopStream(deviceId);
        }
    }
}

/**
 * Pause streaming for a device
 * @param {string} deviceId 
 * @returns {Object|null}
 */
function pauseStream(deviceId) {
    const stream = activeStreams.get(deviceId);
    if (!stream) return null;

    if (stream.intervalId) {
        clearInterval(stream.intervalId);
        stream.intervalId = null;
    }

    stream.status = 'paused';

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
function resumeStream(deviceId) {
    const stream = activeStreams.get(deviceId);
    if (!stream || stream.status !== 'paused') return null;

    stream.status = 'running';

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
function stopStream(deviceId) {
    const stream = activeStreams.get(deviceId);
    if (!stream) return null;

    if (stream.intervalId) {
        clearInterval(stream.intervalId);
    }

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
function getStreamStatus(deviceId) {
    const stream = activeStreams.get(deviceId);
    if (!stream) return null;

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

module.exports = {
    startStream,
    pauseStream,
    resumeStream,
    stopStream,
    getStreamStatus,
    getAllStreams,
    hasActiveStream
};
