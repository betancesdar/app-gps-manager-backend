/**
 * Route Service
 * Manages GPS routes in PostgreSQL
 */

const { v4: uuidv4 } = require('uuid');
const { prisma } = require('../lib/prisma');
const { validateCoordinates } = require('../utils/gpx.parser');
const config = require('../config/config');

/**
 * Create a new route from points
 * @param {Object} routeData 
 * @param {string} userId - User ID from JWT
 * @returns {Object} Created route
 */
async function createRoute(routeData, userId) {
    const { name, points, sourceType = 'points' } = routeData;

    if (!validateCoordinates(points)) {
        throw new Error('Invalid coordinates');
    }

    // Prepare route config with defaults
    const routeConfig = {
        speed: config.STREAM_DEFAULTS.speed,
        accuracy: config.STREAM_DEFAULTS.accuracy,
        intervalMs: config.STREAM_DEFAULTS.intervalMs,
        loop: config.STREAM_DEFAULTS.loop,
        pauses: []
    };

    // Create route with points in a transaction
    const route = await prisma.route.create({
        data: {
            userId,
            name: name || `Route ${uuidv4().substring(0, 8)}`,
            sourceType,
            config: routeConfig,
            points: {
                create: points.map((p, index) => ({
                    seq: index,
                    lat: parseFloat(p.lat),
                    lng: parseFloat(p.lng),
                    speed: p.speed ? parseFloat(p.speed) : null,
                    bearing: p.bearing ? parseFloat(p.bearing) : null,
                    accuracy: p.accuracy ? parseFloat(p.accuracy) : null
                }))
            }
        },
        include: {
            points: {
                orderBy: { seq: 'asc' }
            }
        }
    });

    return formatRouteResponse(route);
}

/**
 * Get route by ID with points
 * @param {string} routeId 
 * @returns {Object|null}
 */
async function getRoute(routeId) {
    const route = await prisma.route.findUnique({
        where: { id: routeId },
        include: {
            points: {
                orderBy: { seq: 'asc' }
            }
        }
    });

    if (!route) return null;
    return formatRouteResponse(route);
}

/**
 * Get all routes (summary without points)
 * @param {string} userId - Optional filter by user
 * @returns {Array}
 */
async function getAllRoutes(userId = null) {
    const where = userId ? { userId } : {};

    const routes = await prisma.route.findMany({
        where,
        include: {
            _count: {
                select: { points: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    return routes.map(r => ({
        routeId: r.id,
        name: r.name,
        sourceType: r.sourceType,
        totalPoints: r._count.points,
        config: r.config,
        createdAt: r.createdAt
    }));
}

/**
 * Update route configuration
 * @param {string} routeId 
 * @param {Object} configData 
 * @returns {Object|null}
 */
async function updateRouteConfig(routeId, configData) {
    try {
        const route = await prisma.route.findUnique({
            where: { id: routeId }
        });

        if (!route) return null;

        const updatedConfig = {
            ...(route.config || {}),
            ...configData
        };

        const updated = await prisma.route.update({
            where: { id: routeId },
            data: { config: updatedConfig },
            include: {
                points: {
                    orderBy: { seq: 'asc' }
                }
            }
        });

        return formatRouteResponse(updated);
    } catch (error) {
        if (error.code === 'P2025') return null;
        throw error;
    }
}

/**
 * Delete route (cascade deletes points)
 * @param {string} routeId 
 * @returns {boolean}
 */
async function deleteRoute(routeId) {
    try {
        await prisma.route.delete({
            where: { id: routeId }
        });
        return true;
    } catch (error) {
        if (error.code === 'P2025') return false;
        throw error;
    }
}

/**
 * Check if route exists
 * @param {string} routeId 
 * @returns {boolean}
 */
async function routeExists(routeId) {
    const count = await prisma.route.count({
        where: { id: routeId }
    });
    return count > 0;
}

/**
 * Format route response to match existing API structure
 * @param {Object} route 
 * @returns {Object}
 */
function formatRouteResponse(route) {
    return {
        routeId: route.id,
        name: route.name,
        sourceType: route.sourceType,
        points: route.points.map(p => ({
            lat: p.lat,
            lng: p.lng,
            speed: p.speed,
            bearing: p.bearing,
            accuracy: p.accuracy
        })),
        config: route.config,
        createdAt: route.createdAt,
        totalPoints: route.points.length
    };
}

module.exports = {
    createRoute,
    getRoute,
    getAllRoutes,
    updateRouteConfig,
    deleteRoute,
    routeExists
};
