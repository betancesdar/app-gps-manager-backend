/**
 * Route Routes
 */

const express = require('express');
const router = express.Router();
const routeController = require('../controllers/route.controller');
const authMiddleware = require('../middleware/auth.middleware');
const adminMiddleware = require('../middleware/admin.middleware');
const rateLimitAddresses = require('../middleware/rateLimit.middleware');

// All routes protected with JWT
router.use(authMiddleware);

// POST /api/routes/from-points
router.post('/from-points', adminMiddleware, routeController.createFromPoints);

// POST /api/routes/from-gpx
router.post('/from-gpx', adminMiddleware, routeController.createFromGPX);

// POST /api/routes/from-addresses (with rate limiting)
router.post('/from-addresses', adminMiddleware, rateLimitAddresses, routeController.createFromAddresses);

// POST /api/routes/from-addresses-with-stops
router.post('/from-addresses-with-stops', adminMiddleware, routeController.createFromAddressesWithStops);

// POST /api/routes/from-waypoints (with rate limiting)
router.post('/from-waypoints', adminMiddleware, rateLimitAddresses, routeController.createFromWaypoints);


// GET /api/routes (Available to all authenticated users)
router.get('/', routeController.getAllRoutes);

// GET /api/routes/:routeId (Available to all authenticated users)
router.get('/:routeId', routeController.getRoute);

// PUT /api/routes/:routeId/config
router.put('/:routeId/config', adminMiddleware, routeController.updateRouteConfig);

// DELETE /api/routes/:routeId
router.delete('/:routeId', adminMiddleware, routeController.deleteRoute);

module.exports = router;
