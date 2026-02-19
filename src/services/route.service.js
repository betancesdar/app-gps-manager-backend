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
                    accuracy: p.accuracy ? parseFloat(p.accuracy) : null,
                    dwellSeconds: p.dwellSeconds ? parseInt(p.dwellSeconds) : 0
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
 * Create a route with named waypoints (origin/stop/destination) and dwell times.
 * Persists route_points (with dwellSeconds) and route_waypoints in a single transaction.
 * @param {Object} routeData - { name, points, waypoints, sourceType }
 * @param {string} userId
 * @returns {Object} Created route with waypoints
 */
async function createRouteWithWaypoints(routeData, userId) {
    const { name, points, waypoints, sourceType = 'ors_waypoints' } = routeData;

    if (!validateCoordinates(points)) {
        throw new Error('Invalid coordinates');
    }

    if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
        throw new Error('At least 2 waypoints are required');
    }

    // Prepare route config with defaults
    const routeConfig = {
        speed: config.STREAM_DEFAULTS.speed,
        accuracy: config.STREAM_DEFAULTS.accuracy,
        intervalMs: config.STREAM_DEFAULTS.intervalMs,
        loop: config.STREAM_DEFAULTS.loop,
        pauses: []
    };

    // Create route + points + waypoints in a single transaction
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
                    accuracy: p.accuracy ? parseFloat(p.accuracy) : null,
                    dwellSeconds: p.dwellSeconds ? parseInt(p.dwellSeconds) : 0
                }))
            },
            waypoints: {
                create: waypoints.map((wp, index) => ({
                    seq: index,
                    kind: wp.kind,
                    mode: wp.mode,
                    label: wp.label || null,
                    text: wp.text || null,
                    lat: parseFloat(wp.lat),
                    lng: parseFloat(wp.lng),
                    dwellSeconds: parseInt(wp.dwellSeconds) || 0,
                    pointIndex: parseInt(wp.pointIndex) || 0
                }))
            }
        },
        include: {
            points: {
                orderBy: { seq: 'asc' }
            },
            waypoints: {
                orderBy: { seq: 'asc' }
            }
        }
    });

    return formatRouteResponseWithWaypoints(route);
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
            },
            waypoints: {
                orderBy: { seq: 'asc' }
            }
        }
    });

    if (!route) return null;
    return formatRouteResponseWithWaypoints(route);
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
                select: { points: true, waypoints: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    return routes.map(r => ({
        routeId: r.id,
        name: r.name,
        sourceType: r.sourceType,
        totalPoints: r._count.points,
        totalWaypoints: r._count.waypoints,
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
                },
                waypoints: {
                    orderBy: { seq: 'asc' }
                }
            }
        });

        return formatRouteResponseWithWaypoints(updated);
    } catch (error) {
        if (error.code === 'P2025') return null;
        throw error;
    }
}

/**
 * Delete route (cascade deletes points and waypoints)
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
            accuracy: p.accuracy,
            dwellSeconds: p.dwellSeconds || 0
        })),
        config: route.config,
        createdAt: route.createdAt,
        totalPoints: route.points.length
    };
}

/**
 * Format route response including waypoints (when available)
 * @param {Object} route 
 * @returns {Object}
 */
function formatRouteResponseWithWaypoints(route) {
    const base = formatRouteResponse(route);
    if (route.waypoints && route.waypoints.length > 0) {
        base.waypoints = route.waypoints.map(wp => ({
            seq: wp.seq,
            kind: wp.kind,
            mode: wp.mode,
            label: wp.label,
            text: wp.text,
            lat: wp.lat,
            lng: wp.lng,
            dwellSeconds: wp.dwellSeconds,
            pointIndex: wp.pointIndex
        }));
    }
    return base;
}

module.exports = {
    createRoute,
    createRouteWithWaypoints,
    getRoute,
    getAllRoutes,
    updateRouteConfig,
    deleteRoute,
    routeExists
};
