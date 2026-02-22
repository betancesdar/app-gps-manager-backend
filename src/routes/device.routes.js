const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/device.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { createIpRateLimit } = require('../middleware/rateLimit.middleware');

// Rate limit: 30 activate attempts per minute per IP
const activateRateLimit = createIpRateLimit(
    30,   // max requests
    60,   // window seconds
    'ratelimit:activate:'
);

// Public routes (for device activation — rate limited by IP)
router.post('/activate', activateRateLimit, deviceController.activate);

// Protected routes (JWT required)
router.use(authMiddleware);

// Standard Device Management
router.post('/register', deviceController.registerDevice);
router.get('/', deviceController.getAllDevices);
router.get('/me', deviceController.getMyDevices); // Keep backward compat
router.get('/:deviceId', deviceController.getDevice);
router.delete('/:deviceId', deviceController.deleteDevice);
router.put('/:deviceId/route', deviceController.assignRoute);

// Advanced Device Management (Admin / Enrollment)
router.post('/enroll', deviceController.enroll);
router.post('/cleanup-stale', deviceController.cleanup);

module.exports = router;
