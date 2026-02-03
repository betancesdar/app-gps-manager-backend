/**
 * Device Controller
 * Handles device registration and management with PostgreSQL + Redis
 */

const deviceService = require('../services/device.service');
const auditService = require('../services/audit.service');

/**
 * POST /api/devices/register
 * Register a new device
 */
async function registerDevice(req, res) {
    try {
        const { deviceId, platform, appVersion } = req.body;
        const userId = req.user.userId; // From JWT middleware

        // Get token from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                error: 'Missing token'
            });
        }
        const token = authHeader.replace('Bearer ', '');

        // Upsert device in PostgreSQL
        const device = await deviceService.registerDevice(
            { deviceId, platform, appVersion },
            userId
        );

        // Authorize device for WebSocket in Redis (TTL 15 min)
        await deviceService.authorizeDeviceForWS(device.deviceId, userId, token);

        // Audit log
        await auditService.log(auditService.ACTIONS.DEVICE_REGISTER, {
            userId,
            deviceId: device.deviceId,
            meta: { platform, appVersion, ip: req.ip }
        });

        return res.status(201).json({
            success: true,
            message: 'Device registered',
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
        console.error('Register device error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to register device'
        });
    }
}

/**
 * GET /api/devices
 * Get all registered devices
 */
async function getAllDevices(req, res) {
    try {
        const devices = await deviceService.getAllDevices();

        return res.status(200).json({
            success: true,
            data: devices.map(d => ({
                deviceId: d.deviceId,
                platform: d.platform,
                appVersion: d.appVersion,
                registeredAt: d.registeredAt,
                lastSeenAt: d.lastSeenAt,
                isConnected: d.isConnected,
                user: d.user?.username
            })),
            count: devices.length
        });
    } catch (error) {
        console.error('Get devices error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get devices'
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
 * Get device by ID
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

        return res.status(200).json({
            success: true,
            data: {
                deviceId: device.deviceId,
                platform: device.platform,
                appVersion: device.appVersion,
                registeredAt: device.registeredAt,
                lastSeenAt: device.lastSeenAt,
                isConnected: device.isConnected,
                user: device.user?.username
            }
        });
    } catch (error) {
        console.error('Get device error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get device'
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
        const userId = req.user.userId;

        const exists = await deviceService.deviceExists(deviceId);
        if (!exists) {
            return res.status(404).json({
                success: false,
                error: 'Device not found'
            });
        }

        await deviceService.deleteDevice(deviceId);

        // Audit log
        await auditService.log(auditService.ACTIONS.DEVICE_DELETE, {
            userId,
            deviceId,
            meta: { ip: req.ip }
        });

        return res.status(200).json({
            success: true,
            message: 'Device deleted'
        });
    } catch (error) {
        console.error('Delete device error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete device'
        });
    }
}

module.exports = {
    registerDevice,
    getAllDevices,
    getMyDevices,
    getDevice,
    deleteDevice
};
