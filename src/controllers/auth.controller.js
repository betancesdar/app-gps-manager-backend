/**
 * Authentication Controller
 * Handles login and token generation
 */

const { generateToken } = require('../utils/jwt.util');
const config = require('../config/config');

/**
 * POST /api/auth/login
 * Simple login with username/password
 */
function login(req, res) {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        // Simple validation (replace with DB lookup in production)
        if (username !== config.DEFAULT_USER.username ||
            password !== config.DEFAULT_USER.password) {
            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Generate JWT token
        const token = generateToken({
            username,
            role: 'admin'
        });

        return res.status(200).json({
            success: true,
            data: {
                token,
                user: {
                    username,
                    role: 'admin'
                }
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

module.exports = {
    login
};
