/**
 * User Controller
 * Handles user management operations
 */

const userService = require('../services/user.service');

/**
 * Get all users (Admin only)
 */
async function getAllUsers(req, res) {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }

        const users = await userService.getAllUsers();

        return res.status(200).json({
            success: true,
            data: users
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch users'
        });
    }
}

/**
 * Create a new user (Admin only)
 */
async function createUser(req, res) {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }

        const { username, password, role } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        // Check if user exists
        const existing = await userService.findByUsername(username);
        if (existing) {
            return res.status(409).json({
                success: false,
                error: 'Username already exists'
            });
        }

        // Default to 'user' role if not specified, but only allow specific roles
        const validRole = (role && ['admin', 'user'].includes(role.toLowerCase())) ? role.toLowerCase() : 'user';

        const user = await userService.createUser({
            username,
            password,
            role: validRole
        });

        return res.status(201).json({
            success: true,
            data: {
                id: user.id,
                username: user.username,
                role: user.role,
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        console.error('Error creating user:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create user'
        });
    }
}

module.exports = {
    getAllUsers,
    createUser
};
