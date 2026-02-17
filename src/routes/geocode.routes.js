/**
 * Geocode Routes
 * Address autocomplete endpoints
 */

const express = require('express');
const router = express.Router();
const geocodeController = require('../controllers/geocode.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All routes protected with JWT
router.use(authMiddleware);

// GET /api/geocode/autocomplete
router.get('/autocomplete', geocodeController.autocomplete);

module.exports = router;
