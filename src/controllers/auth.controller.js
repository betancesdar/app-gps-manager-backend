/**
 * Authentication Controller
 * Handles login with PostgreSQL + bcrypt
 */

const { generateToken } = require('../utils/jwt.util');
const userService = require('../services/user.service');
const auditService = require('../services/audit.service');

/**
 * POST /api/auth/login
 * Login with username/password
 */
async function login(req, res) {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        // Find user in PostgreSQL
        const user = await userService.findByUsername(username);

        if (!user) {
            // Log failed attempt
            await auditService.log(auditService.ACTIONS.LOGIN_FAILED, {
                meta: { username, reason: 'User not found' }
            });

            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Validate password with bcrypt
        const isValidPassword = await userService.validatePassword(password, user.passwordHash);

        if (!isValidPassword) {
            // Log failed attempt
            await auditService.log(auditService.ACTIONS.LOGIN_FAILED, {
                userId: user.id,
                meta: { reason: 'Invalid password' }
            });

            return res.status(401).json({
                success: false,
                error: 'Invalid credentials'
            });
        }

        // Generate JWT token
        const token = generateToken({
            userId: user.id,
            username: user.username,
            role: user.role
        });

        // Log successful login
        await auditService.log(auditService.ACTIONS.LOGIN_SUCCESS, {
            userId: user.id,
            meta: { ip: req.ip }
        });

        return res.status(200).json({
            success: true,
            data: {
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role
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
