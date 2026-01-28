/**
 * Authentication Middleware
 * Protects routes with JWT verification
 */

const { verifyToken } = require('../utils/jwt.util');

/**
 * Middleware to protect routes with JWT authentication
 */
function authMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                error: 'No authorization header provided'
            });
        }

        // Extract token from "Bearer <token>"
        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return res.status(401).json({
                success: false,
                error: 'Invalid authorization format. Use: Bearer <token>'
            });
        }

        const token = parts[1];

        // Verify token
        const decoded = verifyToken(token);

        // Attach user info to request
        req.user = decoded;

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expired'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }

        return res.status(500).json({
            success: false,
            error: 'Authentication error'
        });
    }
}

module.exports = authMiddleware;
