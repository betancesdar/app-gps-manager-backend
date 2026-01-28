/**
 * Route Service
 * Manages GPS routes in memory
 */

const { v4: uuidv4 } = require('uuid');
const { validateCoordinates } = require('../utils/gpx.parser');
const config = require('../config/config');

// In-memory storage for routes
// Map<routeId, RouteInfo>
const routes = new Map();

/**
 * Create a new route from points
 * @param {Object} routeData 
 * @returns {Object} Created route
 */
function createRoute(routeData) {
    const { name, points } = routeData;

    if (!validateCoordinates(points)) {
        throw new Error('Invalid coordinates');
    }

    const routeId = uuidv4();

    const route = {
        routeId,
        name: name || `Route ${routeId.substring(0, 8)}`,
        points: points.map(p => ({
            lat: parseFloat(p.lat),
            lng: parseFloat(p.lng)
        })),
        config: {
            speed: config.STREAM_DEFAULTS.speed,
            accuracy: config.STREAM_DEFAULTS.accuracy,
            intervalMs: config.STREAM_DEFAULTS.intervalMs,
            loop: config.STREAM_DEFAULTS.loop,
            pauses: [] // Array of {afterPointIndex, durationMs}
        },
        createdAt: new Date().toISOString(),
        totalPoints: points.length
    };

    routes.set(routeId, route);

    return route;
}

/**
 * Get route by ID
 * @param {string} routeId 
 * @returns {Object|null}
 */
function getRoute(routeId) {
    return routes.get(routeId) || null;
}

/**
 * Get all routes
 * @returns {Array}
 */
function getAllRoutes() {
    return Array.from(routes.values()).map(r => ({
        routeId: r.routeId,
        name: r.name,
        totalPoints: r.totalPoints,
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
function updateRouteConfig(routeId, configData) {
    const route = routes.get(routeId);
    if (!route) return null;

    route.config = {
        ...route.config,
        ...configData
    };

    routes.set(routeId, route);
    return route;
}

/**
 * Delete route
 * @param {string} routeId 
 * @returns {boolean}
 */
function deleteRoute(routeId) {
    return routes.delete(routeId);
}

/**
 * Check if route exists
 * @param {string} routeId 
 * @returns {boolean}
 */
function routeExists(routeId) {
    return routes.has(routeId);
}

module.exports = {
    createRoute,
    getRoute,
    getAllRoutes,
    updateRouteConfig,
    deleteRoute,
    routeExists
};
