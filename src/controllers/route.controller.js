/**
 * Route Controller
 * Handles route creation and management with PostgreSQL persistence
 */

const routeService = require('../services/route.service');
const auditService = require('../services/audit.service');
const { parseGPX, validateCoordinates } = require('../utils/gpx.parser');

/**
 * POST /api/routes/from-points
 * Create route from array of points
 */
async function createFromPoints(req, res) {
    try {
        const { name, points } = req.body;
        const userId = req.user?.userId;

        if (!points || !Array.isArray(points) || points.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'At least 2 points are required'
            });
        }

        if (!validateCoordinates(points)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid coordinates. Each point must have valid lat and lng'
            });
        }

        const route = await routeService.createRoute({ name, points }, userId);

        // Audit log
        await auditService.log(auditService.ACTIONS.ROUTE_CREATE, {
            userId,
            meta: { routeId: route.routeId, name: route.name, pointCount: points.length }
        });

        return res.status(201).json({
            success: true,
            message: 'Route created',
            data: route
        });
    } catch (error) {
        console.error('Create route error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to create route'
        });
    }
}

/**
 * POST /api/routes/from-gpx
 * Create route from GPX content
 */
async function createFromGPX(req, res) {
    try {
        const { name, gpxContent } = req.body;
        const userId = req.user?.userId;

        if (!gpxContent) {
            return res.status(400).json({
                success: false,
                error: 'GPX content is required'
            });
        }

        const points = parseGPX(gpxContent);

        if (points.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'GPX must contain at least 2 points'
            });
        }

        const route = await routeService.createRoute(
            { name, points, sourceType: 'gpx' },
            userId
        );

        // Audit log
        await auditService.log(auditService.ACTIONS.ROUTE_CREATE, {
            userId,
            meta: { routeId: route.routeId, name: route.name, pointCount: points.length, source: 'gpx' }
        });

        return res.status(201).json({
            success: true,
            message: 'Route created from GPX',
            data: route
        });
    } catch (error) {
        console.error('Create route from GPX error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to parse GPX'
        });
    }
}

/**
 * GET /api/routes
 * Get all routes
 */
async function getAllRoutes(req, res) {
    try {
        const userId = req.user?.userId;
        // If admin, show all routes; otherwise filter by user
        const filterUserId = req.user?.role === 'admin' ? null : userId;

        const routes = await routeService.getAllRoutes(filterUserId);

        return res.status(200).json({
            success: true,
            data: routes,
            count: routes.length
        });
    } catch (error) {
        console.error('Get routes error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get routes'
        });
    }
}

/**
 * GET /api/routes/:routeId
 * Get route by ID with points
 */
async function getRoute(req, res) {
    try {
        const { routeId } = req.params;
        const route = await routeService.getRoute(routeId);

        if (!route) {
            return res.status(404).json({
                success: false,
                error: 'Route not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: route
        });
    } catch (error) {
        console.error('Get route error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get route'
        });
    }
}

/**
 * PUT /api/routes/:routeId/config
 * Update route configuration
 */
async function updateRouteConfig(req, res) {
    try {
        const { routeId } = req.params;
        const { speed, accuracy, intervalMs, loop, pauses } = req.body;

        const exists = await routeService.routeExists(routeId);
        if (!exists) {
            return res.status(404).json({
                success: false,
                error: 'Route not found'
            });
        }

        const configUpdate = {};
        if (speed !== undefined) configUpdate.speed = speed;
        if (accuracy !== undefined) configUpdate.accuracy = accuracy;
        if (intervalMs !== undefined) configUpdate.intervalMs = intervalMs;
        if (loop !== undefined) configUpdate.loop = loop;
        if (pauses !== undefined) configUpdate.pauses = pauses;

        const route = await routeService.updateRouteConfig(routeId, configUpdate);

        return res.status(200).json({
            success: true,
            message: 'Route configuration updated',
            data: route
        });
    } catch (error) {
        console.error('Update route config error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to update route configuration'
        });
    }
}

/**
 * DELETE /api/routes/:routeId
 * Delete route
 */
async function deleteRoute(req, res) {
    try {
        const { routeId } = req.params;
        const userId = req.user?.userId;

        const exists = await routeService.routeExists(routeId);
        if (!exists) {
            return res.status(404).json({
                success: false,
                error: 'Route not found'
            });
        }

        await routeService.deleteRoute(routeId);

        // Audit log
        await auditService.log(auditService.ACTIONS.ROUTE_DELETE, {
            userId,
            meta: { routeId }
        });

        return res.status(200).json({
            success: true,
            message: 'Route deleted'
        });
    } catch (error) {
        console.error('Delete route error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to delete route'
        });
    }
}

module.exports = {
    createFromPoints,
    createFromGPX,
    getAllRoutes,
    getRoute,
    updateRouteConfig,
    deleteRoute
};
