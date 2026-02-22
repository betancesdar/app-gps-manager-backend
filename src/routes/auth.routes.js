/**
 * Authentication Routes
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { createIpRateLimit } = require('../middleware/rateLimit.middleware');

// Rate limit: 10 login attempts per minute per IP
const loginRateLimit = createIpRateLimit(
    10,   // max requests
    60,   // window seconds
    'ratelimit:login:'
);

// POST /api/auth/login
router.post('/login', loginRateLimit, authController.login);

module.exports = router;
