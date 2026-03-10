/**
 * Device Ownership Middleware
 * Verifies that the authenticated user owns the device they are trying to access.
 * Must be used AFTER auth.middleware.js.
 */
const deviceService = require('../services/device.service');

const deviceOwnershipMiddleware = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        // Admins can access all devices
        if (req.user.role === 'admin' || req.user.role === 'ADMIN') {
            return next();
        }

        const deviceId = req.params.deviceId || req.body.deviceId || req.query.deviceId;

        if (!deviceId) {
            // Let the controller handle missing deviceId errors
            return next();
        }

        const device = await deviceService.getDevice(deviceId);

        if (!device) {
            return res.status(404).json({ success: false, error: 'Device not found' });
        }

        if (device.userId !== req.user.userId) {
            return res.status(403).json({ success: false, error: 'Forbidden: You do not own this device' });
        }

        next();
    } catch (error) {
        console.error('Device ownership middleware error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error validating ownership' });
    }
};

module.exports = deviceOwnershipMiddleware;
