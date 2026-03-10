/**
 * Admin Middleware
 * Verifies that the authenticated user has the 'admin' role.
 * Must be used AFTER auth.middleware.js.
 */

const adminMiddleware = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required'
        });
    }

    if (req.user.role !== 'admin' && req.user.role !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            error: 'Forbidden: Administrator access required'
        });
    }

    next();
};

module.exports = adminMiddleware;
