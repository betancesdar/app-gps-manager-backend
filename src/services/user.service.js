/**
 * User Service
 * Handles user authentication with PostgreSQL + bcrypt
 */

const bcrypt = require('bcrypt');
const { prisma } = require('../lib/prisma');
const config = require('../config/config');

const SALT_ROUNDS = 10;

/**
 * Find user by username
 * @param {string} username 
 * @returns {Object|null}
 */
async function findByUsername(username) {
    return prisma.user.findUnique({
        where: { username }
    });
}

/**
 * Find user by ID
 * @param {string} id 
 * @returns {Object|null}
 */
async function findById(id) {
    return prisma.user.findUnique({
        where: { id }
    });
}

/**
 * Create a new user with hashed password
 * @param {Object} userData 
 * @returns {Object}
 */
async function createUser({ username, password, role = 'user' }) {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    return prisma.user.create({
        data: {
            username,
            passwordHash,
            role
        }
    });
}

/**
 * Validate password against stored hash
 * @param {string} password - Plain text password
 * @param {string} passwordHash - Stored hash
 * @returns {boolean}
 */
async function validatePassword(password, passwordHash) {
    return bcrypt.compare(password, passwordHash);
}

/**
 * Ensure default admin user exists (for first run)
 * Creates admin user if not present
 */
async function ensureDefaultUser() {
    const existingAdmin = await findByUsername('admin');

    if (!existingAdmin) {
        console.log('📝 Creating default admin user...');

        await createUser({
            username: 'admin',
            password: config.DEFAULT_ADMIN_PASSWORD,
            role: 'admin'
        });

        console.log('✅ Default admin user created (username: admin)');
    } else {
        console.log('✓ Admin user already exists');
    }
}

/**
 * Get all users (for admin)
 * @returns {Array}
 */
async function getAllUsers() {
    return prisma.user.findMany({
        select: {
            id: true,
            username: true,
            role: true,
            createdAt: true,
            _count: {
                select: { devices: true }
            }
        }
    });
}

module.exports = {
    findByUsername,
    findById,
    createUser,
    validatePassword,
    ensureDefaultUser,
    getAllUsers
};
