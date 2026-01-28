/**
 * Stream Routes
 */

const express = require('express');
const router = express.Router();
const streamController = require('../controllers/stream.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All routes protected with JWT
router.use(authMiddleware);

// POST /api/stream/start
router.post('/start', streamController.startStream);

// POST /api/stream/pause
router.post('/pause', streamController.pauseStream);

// POST /api/stream/resume
router.post('/resume', streamController.resumeStream);

// POST /api/stream/stop
router.post('/stop', streamController.stopStream);

// GET /api/stream/status/:deviceId
router.get('/status/:deviceId', streamController.getStreamStatus);

// GET /api/stream/all
router.get('/all', streamController.getAllStreams);

module.exports = router;
