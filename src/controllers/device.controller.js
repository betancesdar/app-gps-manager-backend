/**
 * Device Controller
 * Handles device registration and management
 */

const deviceService = require('../services/device.service');

/**
 * POST /api/devices/register
 * Register a new device
 */
function registerDevice(req, res) {
    try {
        const { deviceId, platform, appVersion } = req.body;

        // Check if device already exists
        if (deviceId && deviceService.deviceExists(deviceId)) {
            // Update existing device
            const updated = deviceService.updateDevice(deviceId, { platform, appVersion });
            return res.status(200).json({
                success: true,
                message: 'Device updated',
                data: updated
            });
        }

        const device = deviceService.registerDevice({
            deviceId,
            platform,
            appVersion
        });

        return res.status(201).json({
            success: true,
            message: 'Device registered',
            data: device
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
function getAllDevices(req, res) {
    try {
        const devices = deviceService.getAllDevices();

        return res.status(200).json({
            success: true,
            data: devices,
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
 * GET /api/devices/:deviceId
 * Get device by ID
 */
function getDevice(req, res) {
    try {
        const { deviceId } = req.params;
        const device = deviceService.getDevice(deviceId);

        if (!device) {
            return res.status(404).json({
                success: false,
                error: 'Device not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: device
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
function deleteDevice(req, res) {
    try {
        const { deviceId } = req.params;

        if (!deviceService.deviceExists(deviceId)) {
            return res.status(404).json({
                success: false,
                error: 'Device not found'
            });
        }

        deviceService.deleteDevice(deviceId);

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
    getDevice,
    deleteDevice
};
