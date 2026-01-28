/**
 * Route Routes
 */

const express = require('express');
const router = express.Router();
const routeController = require('../controllers/route.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All routes protected with JWT
router.use(authMiddleware);

// POST /api/routes/from-points
router.post('/from-points', routeController.createFromPoints);

// POST /api/routes/from-gpx
router.post('/from-gpx', routeController.createFromGPX);

// GET /api/routes
router.get('/', routeController.getAllRoutes);

// GET /api/routes/:routeId
router.get('/:routeId', routeController.getRoute);

// PUT /api/routes/:routeId/config
router.put('/:routeId/config', routeController.updateRouteConfig);

// DELETE /api/routes/:routeId
router.delete('/:routeId', routeController.deleteRoute);

module.exports = router;
