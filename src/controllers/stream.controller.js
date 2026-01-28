/**
 * Stream Controller
 * Handles real-time coordinate streaming to devices
 */

const streamService = require('../services/stream.service');
const deviceService = require('../services/device.service');
const routeService = require('../services/route.service');

/**
 * POST /api/stream/start
 * Start streaming coordinates to a device
 */
function startStream(req, res) {
    try {
        const { deviceId, routeId, speed, accuracy, loop, intervalMs } = req.body;

        if (!deviceId || !routeId) {
            return res.status(400).json({
                success: false,
                error: 'deviceId and routeId are required'
            });
        }

        // Validate device exists
        if (!deviceService.deviceExists(deviceId)) {
            return res.status(404).json({
                success: false,
                error: 'Device not found'
            });
        }

        // Validate route exists
        if (!routeService.routeExists(routeId)) {
            return res.status(404).json({
                success: false,
                error: 'Route not found'
            });
        }

        const options = {};
        if (speed !== undefined) options.speed = speed;
        if (accuracy !== undefined) options.accuracy = accuracy;
        if (loop !== undefined) options.loop = loop;
        if (intervalMs !== undefined) options.intervalMs = intervalMs;

        const stream = streamService.startStream(deviceId, routeId, options);

        return res.status(200).json({
            success: true,
            message: 'Stream started',
            data: stream
        });
    } catch (error) {
        console.error('Start stream error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to start stream'
        });
    }
}

/**
 * POST /api/stream/pause
 * Pause streaming for a device
 */
function pauseStream(req, res) {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'deviceId is required'
            });
        }

        const result = streamService.pauseStream(deviceId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'No active stream for this device'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Stream paused',
            data: result
        });
    } catch (error) {
        console.error('Pause stream error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to pause stream'
        });
    }
}

/**
 * POST /api/stream/resume
 * Resume streaming for a device
 */
function resumeStream(req, res) {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'deviceId is required'
            });
        }

        const result = streamService.resumeStream(deviceId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'No paused stream for this device'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Stream resumed',
            data: result
        });
    } catch (error) {
        console.error('Resume stream error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to resume stream'
        });
    }
}

/**
 * POST /api/stream/stop
 * Stop streaming for a device
 */
function stopStream(req, res) {
    try {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'deviceId is required'
            });
        }

        const result = streamService.stopStream(deviceId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'No active stream for this device'
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Stream stopped',
            data: result
        });
    } catch (error) {
        console.error('Stop stream error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to stop stream'
        });
    }
}

/**
 * GET /api/stream/status/:deviceId
 * Get stream status for a device
 */
function getStreamStatus(req, res) {
    try {
        const { deviceId } = req.params;

        const status = streamService.getStreamStatus(deviceId);

        if (!status) {
            return res.status(404).json({
                success: false,
                error: 'No stream found for this device'
            });
        }

        return res.status(200).json({
            success: true,
            data: status
        });
    } catch (error) {
        console.error('Get stream status error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get stream status'
        });
    }
}

/**
 * GET /api/stream/all
 * Get all active streams
 */
function getAllStreams(req, res) {
    try {
        const streams = streamService.getAllStreams();

        return res.status(200).json({
            success: true,
            data: streams,
            count: streams.length
        });
    } catch (error) {
        console.error('Get all streams error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get streams'
        });
    }
}

module.exports = {
    startStream,
    pauseStream,
    resumeStream,
    stopStream,
    getStreamStatus,
    getAllStreams
};
