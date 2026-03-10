/**
 * User Routes
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/user.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Apply auth middleware to all user routes
router.use(authMiddleware);

// GET /api/users
router.get('/', userController.getAllUsers);

// POST /api/users
router.post('/', userController.createUser);

module.exports = router;
