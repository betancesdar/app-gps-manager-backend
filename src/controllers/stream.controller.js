/**
 * Stream Controller
 * Handles real-time coordinate streaming to devices
 * Now async for PostgreSQL + Redis operations
 */

const streamService = require('../services/stream.service');
const deviceService = require('../services/device.service');
const routeService = require('../services/route.service');
const auditService = require('../services/audit.service');
const { broadcast } = require('../websocket/ws.server');

/**
 * POST /api/stream/start
 * Start streaming coordinates to a device
 */
async function startStream(req, res) {
    try {
        let { deviceId, routeId, speed, accuracy, loop, intervalMs } = req.body;
        const userId = req.user?.userId;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'deviceId is required'
            });
        }

        // Validate device exists
        const device = await deviceService.getDevice(deviceId);
        if (!device) {
            return res.status(404).json({
                success: false,
                error: 'Device not found'
            });
        }

        // If routeId is missing, check assigned route
        if (!routeId) {
            if (device.assignedRouteId) {
                routeId = device.assignedRouteId;
                console.log(`Using assigned route ${routeId} for device ${deviceId}`);
            } else {
                return res.status(400).json({
                    success: false,
                    error: 'routeId is required or device must have an assigned route'
                });
            }
        }

        // Validate route exists
        const routeExists = await routeService.routeExists(routeId);
        if (!routeExists) {
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

        const stream = await streamService.startStream(deviceId, routeId, options);

        // Audit log
        await auditService.log(auditService.ACTIONS.STREAM_START, {
            userId,
            deviceId,
            meta: { routeId, options }
        });

        // Broadcast stream started
        broadcast('STREAM_STARTED', {
            deviceId,
            routeId,
            speed: stream.config.speed,
            loop: stream.config.loop
        });

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
async function pauseStream(req, res) {
    try {
        const { deviceId } = req.body;
        const userId = req.user?.userId;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'deviceId is required'
            });
        }

        const result = await streamService.pauseStream(deviceId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'No active stream for this device'
            });
        }

        // Audit log
        await auditService.log(auditService.ACTIONS.STREAM_PAUSE, {
            userId,
            deviceId
        });

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
async function resumeStream(req, res) {
    try {
        const { deviceId } = req.body;
        const userId = req.user?.userId;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'deviceId is required'
            });
        }

        const result = await streamService.resumeStream(deviceId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'No paused stream for this device'
            });
        }

        // Audit log
        await auditService.log(auditService.ACTIONS.STREAM_RESUME, {
            userId,
            deviceId
        });

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
async function stopStream(req, res) {
    try {
        const { deviceId } = req.body;
        const userId = req.user?.userId;

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'deviceId is required'
            });
        }

        const result = await streamService.stopStream(deviceId);

        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'No active stream for this device'
            });
        }

        // Audit log
        await auditService.log(auditService.ACTIONS.STREAM_STOP, {
            userId,
            deviceId
        });

        // Broadcast stream stopped
        broadcast('STREAM_STOPPED', { deviceId });

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
async function getStreamStatus(req, res) {
    try {
        const { deviceId } = req.params;

        const status = await streamService.getStreamStatus(deviceId);

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
 * POST /api/stream/skip-dwell
 * Skip current DWELL/WAIT state entirely
 */
async function skipDwell(req, res) {
    try {
        const { deviceId } = req.body;
        const userId = req.user?.userId;

        if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId is required' });

        const result = await streamService.skipDwell(deviceId);
        if (!result || !result.success) {
            return res.status(400).json({ success: false, error: result?.message || 'Failed to skip dwell' });
        }

        await auditService.log(auditService.ACTIONS.STREAM_WAITING_SKIP, { userId, deviceId });

        return res.status(200).json({
            success: true,
            message: 'Dwell skipped successfully',
            data: result
        });
    } catch (error) {
        console.error('Skip dwell error:', error);
        return res.status(500).json({ success: false, error: 'Failed to skip dwell' });
    }
}

/**
 * POST /api/stream/extend-dwell
 * Add more time to the current DWELL/WAIT state
 */
async function extendDwell(req, res) {
    try {
        const { deviceId, seconds } = req.body;
        const userId = req.user?.userId;

        if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId is required' });
        if (!seconds || isNaN(seconds) || seconds <= 0) {
            return res.status(400).json({ success: false, error: 'valid positive seconds parameter is required' });
        }

        const result = await streamService.extendDwell(deviceId, parseInt(seconds));
        if (!result || !result.success) {
            return res.status(400).json({ success: false, error: result?.message || 'Failed to extend dwell' });
        }

        await auditService.log(auditService.ACTIONS.STREAM_WAITING_EXTEND, {
            userId,
            deviceId,
            meta: { addedSeconds: seconds }
        });

        return res.status(200).json({
            success: true,
            message: `Dwell extended by ${seconds}s successfully`,
            data: result
        });
    } catch (error) {
        console.error('Extend dwell error:', error);
        return res.status(500).json({ success: false, error: 'Failed to extend dwell' });
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

/**
 * GET /api/stream/history/:deviceId
 * Get stream history for a device
 */
async function getStreamHistory(req, res) {
    try {
        const { deviceId } = req.params;
        const limit = parseInt(req.query.limit) || 10;

        const history = await streamService.getStreamHistory(deviceId, limit);

        return res.status(200).json({
            success: true,
            data: history,
            count: history.length
        });
    } catch (error) {
        console.error('Get stream history error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get stream history'
        });
    }
}

module.exports = {
    startStream,
    pauseStream,
    resumeStream,
    stopStream,
    getStreamStatus,
    getAllStreams,
    getStreamHistory,
    skipDwell,
    extendDwell
};
