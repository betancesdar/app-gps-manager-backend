/**
 * Device Routes
 */

const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/device.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All routes protected with JWT
router.use(authMiddleware);

// POST /api/devices/register
router.post('/register', deviceController.registerDevice);

// GET /api/devices
router.get('/', deviceController.getAllDevices);

// GET /api/devices/:deviceId
router.get('/:deviceId', deviceController.getDevice);

// DELETE /api/devices/:deviceId
router.delete('/:deviceId', deviceController.deleteDevice);

// PUT /api/devices/:deviceId/route
router.put('/:deviceId/route', deviceController.assignRoute);

module.exports = router;
