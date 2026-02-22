/**
 * Device Controller
 * Handles device registration, management, and enrollment
 */

const deviceService = require('../services/device.service');
const auditService = require('../services/audit.service');
const routeService = require('../services/route.service');

/**
 * POST /api/devices/register
 * Register a new device (Idempotent)
 */
async function registerDevice(req, res) {
    try {
        const { deviceId, platform, appVersion } = req.body;
        const userId = req.user.userId; // From JWT middleware

        // Strict validation handled by service now, but we catch it here
        const device = await deviceService.registerDevice(
            { deviceId, platform, appVersion },
            userId
        );

        // Authorize for WS (Legacy flow: user token)
        // If client sends token, we cache it in Redis for WS auth
        const authHeader = req.headers.authorization;
        if (authHeader) {
            const token = authHeader.replace('Bearer ', '');
            await deviceService.authorizeDeviceForWS(device.deviceId, userId, token);
        }

        // Audit log
        await auditService.log(auditService.ACTIONS.DEVICE_REGISTER, {
            userId,
            deviceId: device.deviceId,
            meta: { platform, appVersion, ip: req.ip }
        });

        return res.status(200).json({
            success: true,
            data: {
                deviceId: device.deviceId,
                platform: device.platform,
                appVersion: device.appVersion,
                registeredAt: device.registeredAt,
                lastSeenAt: device.lastSeenAt,
                isConnected: device.isConnected
            }
        });
    } catch (error) {
        if (error.code === 'MISSING_DEVICE_ID') {
            return res.status(400).json({
                success: false,
                error: 'deviceId is required'
            });
        }
        console.error('Register device error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to register device'
        });
    }
}

/**
 * GET /api/devices
 * Get all devices (Admin)
 * Supports ?activeWithinSeconds=600&page=1&limit=20
 * Sorts: Connected > Disconnected, then by lastSeenAt desc
 */
async function getAllDevices(req, res) {
    try {
        const { activeWithinSeconds } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

        let devices = await deviceService.getAllDevices();

        // Filter
        if (activeWithinSeconds) {
            const cutoff = new Date(Date.now() - parseInt(activeWithinSeconds) * 1000);
            devices = devices.filter(d => new Date(d.lastSeenAt) > cutoff);
        }

        // Sort: Connected first, then by Last Seen
        devices.sort((a, b) => {
            if (a.isConnected === b.isConnected) {
                return new Date(b.lastSeenAt) - new Date(a.lastSeenAt);
            }
            return a.isConnected ? -1 : 1;
        });

        const total = devices.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        const paged = devices.slice(offset, offset + limit);

        return res.status(200).json({
            success: true,
            data: paged.map(d => ({
                deviceId: d.deviceId,
                label: d.label,
                platform: d.platform,
                appVersion: d.appVersion,
                registeredAt: d.registeredAt,
                lastSeenAt: d.lastSeenAt,
                isConnected: d.isConnected,
                user: d.user?.username
            })),
            pagination: { page, limit, total, totalPages, hasMore: page < totalPages },
            count: paged.length
        });
    } catch (error) {
        console.error('Get devices error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch devices'
        });
    }
}

/**
 * GET /api/devices/me
 * Get devices for current user
 */
async function getMyDevices(req, res) {
    try {
        const userId = req.user.userId;
        const devices = await deviceService.getDevicesByUser(userId);

        return res.status(200).json({
            success: true,
            data: devices,
            count: devices.length
        });
    } catch (error) {
        console.error('Get my devices error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get devices'
        });
    }
}

/**
 * GET /api/devices/:deviceId
 * Get device details
 */
async function getDevice(req, res) {
    try {
        const { deviceId } = req.params;
        const device = await deviceService.getDevice(deviceId);

        if (!device) {
            return res.status(404).json({
                success: false,
                error: 'Device not found'
            });
        }

        res.json({
            success: true,
            data: device
        });
    } catch (error) {
        console.error('Get device error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch device'
        });
    }
}

/**
 * DELETE /api/devices/:deviceId
 * Delete device
 */
async function deleteDevice(req, res) {
    try {
        const { deviceId } = req.params;
        const success = await deviceService.deleteDevice(deviceId);

        if (!success) {
            return res.status(404).json({
                success: false,
                error: 'Device not found'
            });
        }

        await auditService.log(auditService.ACTIONS.DEVICE_DELETE, {
            userId: req.user.userId,
            deviceId
        });

        res.json({
            success: true,
            message: 'Device deleted'
        });
    } catch (error) {
        console.error('Delete device error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete device'
        });
    }
}

/**
 * PUT /api/devices/:deviceId/route
 * Assign a route to a device
 */
async function assignRoute(req, res) {
    try {
        const { deviceId } = req.params;
        const { routeId } = req.body;

        if (!routeId) {
            return res.status(400).json({
                success: false,
                error: 'routeId is required'
            });
        }

        // Verify route exists
        const route = await routeService.getRoute(routeId);
        if (!route) {
            return res.status(404).json({
                success: false,
                error: 'Route not found'
            });
        }

        // Verify device exists
        const deviceExists = await deviceService.deviceExists(deviceId);
        if (!deviceExists) {
            return res.status(404).json({
                success: false,
                error: 'Device not found'
            });
        }

        const device = await deviceService.assignRouteToDevice(deviceId, routeId);

        await auditService.log(auditService.ACTIONS.DEVICE_UPDATE, {
            userId: req.user.userId,
            deviceId,
            meta: { action: 'ASSIGN_ROUTE', routeId }
        });

        res.json({
            success: true,
            data: device
        });
    } catch (error) {
        console.error('Assign route error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to assign route'
        });
    }
}

// ── Enrollment Endpoints (Redis) ─────────────────────────────────────

/**
 * POST /api/devices/enroll
 * Generate enrollment code (Admin)
 */
async function enroll(req, res) {
    try {
        // req.body: { label?, requestedDeviceId? }
        const result = await deviceService.createEnrollment(req.user, req.body);
        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Enroll error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

/**
 * POST /api/devices/activate (or /enroll/confirm)
 * Exchange code for device token (Public)
 */
async function confirm(req, res) {
    try {
        // req.body: { enrollmentCode, platform, appVersion, deviceInfo... }
        const { enrollmentCode } = req.body;
        if (!enrollmentCode) return res.status(400).json({ success: false, error: 'enrollmentCode required' });

        const result = await deviceService.confirmEnrollment(enrollmentCode, req.body);

        res.json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error('Confirm enrollment error:', error);
        res.status(400).json({ success: false, error: error.message || 'Confirmation failed' });
    }
}

// Alias for backward compatibility if needed, but new flow uses confirm
const activate = confirm;

/**
 * POST /api/devices/cleanup-stale
 * Delete stale devices (Admin)
 */
async function cleanup(req, res) {
    try {
        const { olderThanSeconds } = req.body;
        const seconds = parseInt(olderThanSeconds) || 86400 * 30; // default 30 days

        const count = await deviceService.cleanupStaleDevices(seconds);

        res.json({
            success: true,
            data: { deletedCount: count, matchCriteria: 'inactive AND no active streams' }
        });
    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
}

module.exports = {
    registerDevice,
    getAllDevices,
    getMyDevices, // Kept for backward compat
    getDevice,
    deleteDevice,
    assignRoute,
    enroll,
    activate,
    cleanup
};
