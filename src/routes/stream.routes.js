/**
 * Stream Routes
 */

const express = require('express');
const router = express.Router();
const streamController = require('../controllers/stream.controller');
const authMiddleware = require('../middleware/auth.middleware');
const deviceOwnershipMiddleware = require('../middleware/deviceOwnership.middleware');

// All routes protected with JWT
router.use(authMiddleware);

// POST /api/stream/start
router.post('/start', deviceOwnershipMiddleware, streamController.startStream);

// POST /api/stream/pause
router.post('/pause', deviceOwnershipMiddleware, streamController.pauseStream);

// POST /api/stream/resume
router.post('/resume', deviceOwnershipMiddleware, streamController.resumeStream);

// POST /api/stream/stop
router.post('/stop', deviceOwnershipMiddleware, streamController.stopStream);

// POST /api/stream/skip-dwell
router.post('/skip-dwell', deviceOwnershipMiddleware, streamController.skipDwell);

// POST /api/stream/extend-dwell
router.post('/extend-dwell', deviceOwnershipMiddleware, streamController.extendDwell);

// GET /api/stream/status/:deviceId
router.get('/status/:deviceId', deviceOwnershipMiddleware, streamController.getStreamStatus);

// GET /api/stream/all
router.get('/all', streamController.getAllStreams);

module.exports = router;
