/**
 * Route Controller
 * Handles route creation and management with PostgreSQL persistence
 */

const routeService = require('../services/route.service');
const auditService = require('../services/audit.service');
const orsService = require('../services/ors.service');
const { parseGPX, validateCoordinates } = require('../utils/gpx.parser');
const geospatialUtil = require('../utils/geospatial.util');
const { resamplePoints, calculateBearing } = geospatialUtil;
const routeSafetyService = require('../services/route.safety.service');
const config = require('../config/config');

function applySafetyGate(points) {
    if (!config.ROUTE_SAFETY_GATE) return points;
    let safePoints = routeSafetyService.sanitizePoints(points);
    routeSafetyService.validatePoints(safePoints, config);
    safePoints = routeSafetyService.simplifyPoints(safePoints, config.ROUTE_SIMPLIFY_METERS);
    safePoints = routeSafetyService.resampleByDistance(safePoints, config.ROUTE_RESAMPLE_METERS);
    routeSafetyService.detectSpikes(safePoints);
    return safePoints;
}

/**
 * POST /api/routes/from-points
 * Create route from array of points
 */
async function createFromPoints(req, res) {
    try {
        const { name, points } = req.body;
        const userId = req.user?.userId;

        // Validate user is authenticated
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

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

        points = applySafetyGate(points);

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

        // Validate user is authenticated
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

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

        const safePoints = applySafetyGate(points);

        const route = await routeService.createRoute(
            { name, points: safePoints, sourceType: 'gpx' },
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
 * POST /api/routes/from-addresses
 * Create route from origin and destination addresses using OpenRouteService
 */
async function createFromAddresses(req, res) {
    try {
        const {
            name,
            originText,
            destinationText,
            profile = 'driving-car',
            pointSpacingMeters,
            waitAtEndSeconds = 0
        } = req.body;

        const userId = req.user?.userId;

        // Validate user is authenticated
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        // Validate required fields
        if (!originText || !destinationText) {
            return res.status(400).json({
                success: false,
                error: 'originText and destinationText are required'
            });
        }

        // Validate point spacing
        const spacing = pointSpacingMeters || config.ORS_DEFAULT_POINT_SPACING;
        if (spacing <= 0 || spacing > 1000) {
            return res.status(400).json({
                success: false,
                error: 'pointSpacingMeters must be between 1 and 1000'
            });
        }

        console.log(`[RouteController] Creating route from addresses: "${originText}" -> "${destinationText}"`);

        // Step 1: Geocode origin and destination
        let origin, destination;
        try {
            origin = await orsService.geocodeAddress(originText);
            destination = await orsService.geocodeAddress(destinationText);
        } catch (geocodeError) {
            return res.status(400).json({
                success: false,
                error: `Geocoding failed: ${geocodeError.message}`
            });
        }

        console.log(`[RouteController] Geocoded: Origin(${origin.lat}, ${origin.lng}), Destination(${destination.lat}, ${destination.lng})`);

        // Step 2: Get directions from ORS
        let directionsResult;
        try {
            directionsResult = await orsService.getDirections(origin, destination, profile);
        } catch (directionsError) {
            return res.status(502).json({
                success: false,
                error: `Directions service failed: ${directionsError.message}`
            });
        }

        const { geometry, distanceMeters, durationSeconds } = directionsResult;

        console.log(`[RouteController] Route calculated: ${distanceMeters}m, ${durationSeconds}s, ${geometry.length} raw points`);

        // Step 3: Resample points for smooth mock location
        let resampledPoints;
        try {
            resampledPoints = resamplePoints(geometry, spacing);
        } catch (resampleError) {
            return res.status(500).json({
                success: false,
                error: `Point resampling failed: ${resampleError.message}`
            });
        }

        console.log(`[RouteController] Resampled to ${resampledPoints.length} points at ${spacing}m spacing`);

        // Step 4: Calculate bearing for each point
        const pointsWithMetadata = resampledPoints.map((point, index) => {
            const nextPoint = index < resampledPoints.length - 1
                ? resampledPoints[index + 1]
                : null;

            return {
                lat: point.lat,
                lng: point.lng,
                bearing: nextPoint ? calculateBearing(point, nextPoint) : null,
                speed: null, // Will be determined by stream config
                accuracy: null
            };
        });

        // Step 5: Add wait duration to last point if specified
        if (waitAtEndSeconds > 0 && pointsWithMetadata.length > 0) {
            pointsWithMetadata[pointsWithMetadata.length - 1].waitDuration = waitAtEndSeconds;
        }

        const safePoints = applySafetyGate(pointsWithMetadata);

        // Step 6: Create route in database
        const route = await routeService.createRoute(
            {
                name: name || `${originText} → ${destinationText}`,
                points: safePoints,
                sourceType: 'ors'
            },
            userId
        );

        // Step 7: Audit log
        await auditService.log(auditService.ACTIONS.ROUTE_CREATE, {
            userId,
            meta: {
                routeId: route.routeId,
                name: route.name,
                pointCount: pointsWithMetadata.length,
                source: 'ors',
                profile,
                distanceMeters,
                durationSeconds,
                originText,
                destinationText
            }
        });

        console.log(`[RouteController] ✅ Route created: ${route.routeId}`);

        return res.status(201).json({
            success: true,
            message: 'Route created from addresses',
            data: {
                routeId: route.routeId,
                name: route.name,
                distanceM: Math.round(distanceMeters),
                durationS: Math.round(durationSeconds),
                pointsCount: pointsWithMetadata.length,
                pointSpacingMeters: spacing
            }
        });

    } catch (error) {
        console.error('[RouteController] Create route from addresses error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to create route from addresses'
        });
    }
}
/**
 * POST /api/routes/from-addresses-with-stops
 * Create route from multiple stops (addresses or manual coords)
 * with optional wait times and point spacing
 */
async function createFromAddressesWithStops(req, res) {
    try {
        const {
            name,
            stops,
            profile = 'driving-car',
            pointSpacingMeters
        } = req.body;

        const userId = req.user?.userId;

        // Validate user is authenticated
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: 'User not authenticated'
            });
        }

        // Validate stops
        if (!stops || !Array.isArray(stops) || stops.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'At least 2 stops are required'
            });
        }

        // Validate point spacing
        const spacing = pointSpacingMeters || config.ORS_DEFAULT_POINT_SPACING;
        if (spacing <= 0 || spacing > 1000) {
            return res.status(400).json({
                success: false,
                error: 'pointSpacingMeters must be between 1 and 1000'
            });
        }

        console.log(`[RouteController] Creating route with ${stops.length} stops`);

        // Step 1: Resolve all stops to coordinates
        const resolvedStops = [];
        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            let coords;

            if (stop.lat !== undefined && stop.lng !== undefined) {
                // Manual coordinates
                coords = { lat: parseFloat(stop.lat), lng: parseFloat(stop.lng) };
                if (isNaN(coords.lat) || isNaN(coords.lng)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid coordinates at stop ${i + 1}`
                    });
                }
            } else if (stop.text) {
                // Address to geocode
                try {
                    coords = await orsService.geocodeAddress(stop.text);
                } catch (err) {
                    return res.status(400).json({
                        success: false,
                        error: `Geocoding failed for stop ${i + 1} ("${stop.text}"): ${err.message}`
                    });
                }
            } else {
                return res.status(400).json({
                    success: false,
                    error: `Stop ${i + 1} must have either lat/lng or text`
                });
            }

            resolvedStops.push({
                ...coords,
                waitSeconds: stop.waitSeconds || 0,
                label: stop.label || stop.text || `Stop ${i + 1}`
            });
        }

        // Step 2: Build route segments
        let allPoints = [];
        let totalDistance = 0;
        let totalDuration = 0;

        for (let i = 0; i < resolvedStops.length - 1; i++) {
            const start = resolvedStops[i];
            const end = resolvedStops[i + 1];

            console.log(`[RouteController] Fetching segment ${i + 1}: ${start.label} -> ${end.label}`);

            let segmentResult;
            try {
                segmentResult = await orsService.getDirections(start, end, profile);
            } catch (err) {
                return res.status(502).json({
                    success: false,
                    error: `Directions failed for segment ${i + 1}: ${err.message}`
                });
            }

            const { geometry, distanceMeters, durationSeconds } = segmentResult;
            totalDistance += distanceMeters;
            totalDuration += durationSeconds;

            // Resample points
            let resampledSeg = resamplePoints(geometry, spacing);

            // Calculate bearing
            resampledSeg = resampledSeg.map((p, idx) => {
                const next = idx < resampledSeg.length - 1 ? resampledSeg[idx + 1] : null;
                return {
                    lat: p.lat,
                    lng: p.lng,
                    bearing: next ? calculateBearing(p, next) : (allPoints.length > 0 ? allPoints[allPoints.length - 1].bearing : 0),
                    speed: null,
                    accuracy: null
                };
            });

            // Handle WAIT at the START of the FIRST segment (Origin)
            if (i === 0 && start.waitSeconds > 0) {
                const firstPoint = resampledSeg[0];
                const repeats = Math.ceil(start.waitSeconds);
                console.log(`[RouteController] Adding ${repeats} wait points at Origin (${start.label})`);
                for (let r = 0; r < repeats; r++) {
                    allPoints.push({
                        ...firstPoint,
                        speed: 0
                    });
                }
                totalDuration += start.waitSeconds;
            }

            // Prevent duplicate points at joins (except for the very first point of the route)
            // If allPoints is not empty, and the first point of this segment matches the last of allPoints, skip it.
            // However, ORS might return slightly different coords for the same place?
            // Safer: Just allow it or filter if distance is 0.
            // For simplicity and "clean" routes, let's keep all resampled points but the join might have tiny overlaps.
            // Actually, we should probably strip the first point of the segment IF it's not the first segment
            if (i > 0) {
                // Reuse the last point of previous segment to ensure continuity?
                // Or just append. Appending is safer to avoid gaps.
            }

            // Append segment points
            allPoints = allPoints.concat(resampledSeg);

            // Handle WAIT at the END of this segment (which is 'end' stop)
            // If end.waitSeconds > 0, we duplicate the last point
            if (end.waitSeconds > 0) {
                const lastPoint = resampledSeg[resampledSeg.length - 1];
                // Assume 1 second per tick for generic playback representation
                // User requirement: "repeats = ceil(waitSeconds * 1000 / tickMs)"
                // We assume tickMs = 1000 for storage estimation
                const repeats = Math.ceil(end.waitSeconds);

                console.log(`[RouteController] Adding ${repeats} wait points at ${end.label}`);
                for (let r = 0; r < repeats; r++) {
                    allPoints.push({
                        ...lastPoint,
                        speed: 0 // Explicitly 0 speed for wait
                    });
                }

                // Add wait duration to totals
                totalDuration += end.waitSeconds;
            }
        }

        console.log(`[RouteController] Total route: ${Math.round(totalDistance)}m, ${allPoints.length} points`);

        const safePoints = applySafetyGate(allPoints);

        // Step 3: Persist
        const route = await routeService.createRoute(
            {
                name: name || `${resolvedStops[0].label} -> ${resolvedStops[resolvedStops.length - 1].label}`,
                points: safePoints,
                sourceType: 'ors_stops'
            },
            userId
        );

        // Step 4: Audit log
        await auditService.log(auditService.ACTIONS.ROUTE_CREATE, {
            userId,
            meta: {
                routeId: route.routeId,
                name: route.name,
                pointCount: allPoints.length,
                source: 'ors_stops',
                stopCount: stops.length,
                totalDistance,
                totalDuration
            }
        });

        return res.status(201).json({
            success: true,
            message: 'Route with stops created',
            data: {
                routeId: route.routeId,
                name: route.name,
                distanceM: Math.round(totalDistance),
                durationS: Math.round(totalDuration),
                pointsCount: allPoints.length,
                pointSpacingMeters: spacing
            }
        });

    } catch (error) {
        console.error('[RouteController] Create route with stops error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to create route with stops'
        });
    }
}

/**
 * GET /api/routes
 * Get all routes
 * Supports ?page=1&limit=20
 */
async function getAllRoutes(req, res) {
    try {
        const userId = req.user?.userId;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

        // If admin, show all routes; otherwise filter by user
        const filterUserId = req.user?.role === 'admin' ? null : userId;

        const routes = await routeService.getAllRoutes(filterUserId);

        const total = routes.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        const paged = routes.slice(offset, offset + limit);

        return res.status(200).json({
            success: true,
            data: paged,
            pagination: { page, limit, total, totalPages, hasMore: page < totalPages },
            count: paged.length
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

/**
 * POST /api/routes/from-waypoints
 * Create route from waypoints array with optional dwellSeconds per stop.
 * Supports mode=address (geocoded via ORS) and mode=manual (lat/lng provided).
 * Backward compatible: does NOT replace from-addresses or from-addresses-with-stops.
 */
async function createFromWaypoints(req, res) {
    try {
        const {
            name,
            profile = 'driving-car',
            pointSpacingMeters,
            waypoints
        } = req.body;

        const userId = req.user?.userId;

        if (!userId) {
            return res.status(401).json({ success: false, error: 'User not authenticated' });
        }

        const crypto = require('crypto');

        // ── Validate waypoints array ──────────────────────────────────────
        if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
            return res.status(400).json({
                success: false,
                error: 'waypoints must be an array with at least 2 entries'
            });
        }

        const VALID_KINDS = ['origin', 'stop', 'destination'];
        const VALID_MODES = ['address', 'manual'];

        for (let i = 0; i < waypoints.length; i++) {
            const wp = waypoints[i];
            if (!VALID_KINDS.includes(wp.kind)) {
                return res.status(400).json({
                    success: false,
                    error: `waypoints[${i}].kind must be one of: ${VALID_KINDS.join(', ')}`
                });
            }
            if (!VALID_MODES.includes(wp.mode)) {
                return res.status(400).json({
                    success: false,
                    error: `waypoints[${i}].mode must be one of: ${VALID_MODES.join(', ')}`
                });
            }
            if (wp.mode === 'address' && !wp.text) {
                return res.status(400).json({
                    success: false,
                    error: `waypoints[${i}] has mode=address but is missing text`
                });
            }
            if (wp.mode === 'manual' && (wp.lat == null || wp.lng == null)) {
                return res.status(400).json({
                    success: false,
                    error: `waypoints[${i}] has mode=manual but is missing lat/lng`
                });
            }
            if (wp.dwellSeconds !== undefined && (isNaN(Number(wp.dwellSeconds)) || Number(wp.dwellSeconds) < 0)) {
                return res.status(400).json({
                    success: false,
                    error: `waypoints[${i}].dwellSeconds must be >= 0`
                });
            }
        }

        // Exactly 1 origin and 1 destination
        const origins = waypoints.filter(wp => wp.kind === 'origin');
        const destinations = waypoints.filter(wp => wp.kind === 'destination');
        if (origins.length !== 1) {
            return res.status(400).json({ success: false, error: 'Exactly 1 waypoint with kind=origin is required' });
        }
        if (destinations.length !== 1) {
            return res.status(400).json({ success: false, error: 'Exactly 1 waypoint with kind=destination is required' });
        }
        if (waypoints[0].kind !== 'origin') {
            return res.status(400).json({ success: false, error: 'First waypoint must have kind=origin' });
        }
        if (waypoints[waypoints.length - 1].kind !== 'destination') {
            return res.status(400).json({ success: false, error: 'Last waypoint must have kind=destination' });
        }

        // Validate point spacing
        const spacing = pointSpacingMeters || config.ORS_DEFAULT_POINT_SPACING;
        if (spacing <= 0 || spacing > 1000) {
            return res.status(400).json({
                success: false,
                error: 'pointSpacingMeters must be between 1 and 1000'
            });
        }

        console.log(`[RouteController] Creating route from ${waypoints.length} waypoints`);

        // ── Step 0: Idempotency Logic ─────────────────────────────────────
        const payloadStr = JSON.stringify({ name, waypoints, profile, spacing });
        const idempotencyKey = req.headers['x-idempotency-key'] || crypto.createHash('sha256').update(payloadStr).digest('hex');

        // Check recent routes (last 10 minutes)
        const recentDate = new Date(Date.now() - 10 * 60 * 1000);
        const { prisma } = require('../lib/prisma');
        const existingRoutes = await prisma.route.findMany({
            where: {
                userId: userId,
                sourceType: 'ors_waypoints',
                createdAt: { gte: recentDate }
            }
        });

        const duplicate = existingRoutes.find(r => r.config && r.config.idempotencyKey === idempotencyKey);
        if (duplicate) {
            console.log(`[RouteController] Idempotency hit: returning existing route ${duplicate.id}`);
            const fullRoute = await routeService.getRoute(duplicate.id);
            if (fullRoute) {
                return res.status(200).json({
                    success: true,
                    message: 'Route with waypoints returned (idempotency)',
                    data: {
                        routeId: fullRoute.routeId,
                        name: fullRoute.name,
                        distanceM: duplicate.config.distanceM || 0,
                        durationS: duplicate.config.durationS || 0,
                        pointsCount: fullRoute.points?.length || 0,
                        pointSpacingMeters: spacing,
                        waypoints: fullRoute.waypoints
                    }
                });
            }
        }

        // ── Step 1: Resolve all waypoints to coordinates ─────────────────
        const resolvedWaypoints = [];
        for (let i = 0; i < waypoints.length; i++) {
            const wp = waypoints[i];
            let lat, lng;

            if (wp.mode === 'manual') {
                lat = parseFloat(wp.lat);
                lng = parseFloat(wp.lng);
                if (isNaN(lat) || isNaN(lng)) {
                    return res.status(400).json({
                        success: false,
                        error: `waypoints[${i}] has invalid lat/lng values`
                    });
                }
            } else {
                // mode === 'address' — geocode via ORS
                try {
                    const coords = await orsService.geocodeAddress(wp.text);
                    lat = coords.lat;
                    lng = coords.lng;
                } catch (geocodeError) {
                    return res.status(400).json({
                        success: false,
                        error: `Geocoding failed for waypoints[${i}] ("${wp.text}"): ${geocodeError.message}. Tip: use mode=manual and provide lat/lng directly.`
                    });
                }
            }

            resolvedWaypoints.push({
                ...wp,
                lat,
                lng,
                dwellSeconds: parseInt(wp.dwellSeconds) || 0
            });
        }

        // ── Step 2: Get directions for all waypoints in one ORS call ──────
        let directionsResult;
        try {
            directionsResult = await orsService.getDirectionsMulti(resolvedWaypoints, profile);
        } catch (directionsError) {
            return res.status(502).json({
                success: false,
                error: `Directions service failed: ${directionsError.message}`
            });
        }

        const { geometry, distanceMeters, durationSeconds } = directionsResult;
        console.log(`[RouteController] Route: ${Math.round(distanceMeters)}m, ${Math.round(durationSeconds)}s, ${geometry.length} raw points`);

        // ── Step 3: Resample geometry ─────────────────────────────────────
        let resampledPoints;
        try {
            resampledPoints = resamplePoints(geometry, spacing);
        } catch (resampleError) {
            return res.status(500).json({
                success: false,
                error: `Point resampling failed: ${resampleError.message}`
            });
        }
        console.log(`[RouteController] Resampled to ${resampledPoints.length} points at ${spacing}m spacing`);

        // ── Step 4: Calculate bearing per point ───────────────────────────
        const pointsWithMeta = resampledPoints.map((point, index) => {
            const nextPoint = index < resampledPoints.length - 1 ? resampledPoints[index + 1] : null;
            return {
                lat: point.lat,
                lng: point.lng,
                bearing: nextPoint ? calculateBearing(point, nextPoint) : null,
                speed: null,
                accuracy: null,
                dwellSeconds: 0 // will be set below for waypoint points
            };
        });

        // ── Step 5: Map waypoints to nearest route point indices ──────────
        // For each waypoint, find the closest point in the resampled array
        // and mark it with dwellSeconds.
        const { calculateDistance } = geospatialUtil;
        const waypointsWithIndex = resolvedWaypoints.map((wp, wpIdx) => {
            let bestIdx = 0;
            let bestDist = Infinity;
            for (let pi = 0; pi < pointsWithMeta.length; pi++) {
                const d = calculateDistance(pointsWithMeta[pi], wp);
                if (d < bestDist) {
                    bestDist = d;
                    bestIdx = pi;
                }
            }
            // Mark the route point with dwell
            if (wp.dwellSeconds > 0) {
                pointsWithMeta[bestIdx].dwellSeconds = wp.dwellSeconds;
            }
            return { ...wp, pointIndex: bestIdx };
        });

        // ── Step 6: Persist route + waypoints ────────────────────────────
        const routeName = name || `${resolvedWaypoints[0].label || 'Origin'} → ${resolvedWaypoints[resolvedWaypoints.length - 1].label || 'Destination'}`;

        const safePoints = applySafetyGate(pointsWithMeta);

        const route = await routeService.createRouteWithWaypoints(
            {
                name: routeName,
                points: safePoints,
                waypoints: waypointsWithIndex,
                sourceType: 'ors_waypoints'
            },
            userId
        );

        // Append metrics and idempotency key to route configuration
        await routeService.updateRouteConfig(route.routeId, {
            idempotencyKey,
            distanceM: Math.round(distanceMeters),
            durationS: Math.round(durationSeconds)
        });

        // ── Step 7: Audit log ─────────────────────────────────────────────
        await auditService.log(auditService.ACTIONS.ROUTE_CREATE, {
            userId,
            meta: {
                routeId: route.routeId,
                name: route.name,
                pointCount: pointsWithMeta.length,
                waypointCount: waypoints.length,
                source: 'ors_waypoints',
                profile,
                distanceMeters: Math.round(distanceMeters),
                durationSeconds: Math.round(durationSeconds)
            }
        });

        console.log(`[RouteController] ✅ Route with waypoints created: ${route.routeId}`);

        return res.status(201).json({
            success: true,
            message: 'Route with waypoints created',
            data: {
                routeId: route.routeId,
                name: route.name,
                distanceM: Math.round(distanceMeters),
                durationS: Math.round(durationSeconds),
                pointsCount: pointsWithMeta.length,
                pointSpacingMeters: spacing,
                waypoints: route.waypoints
            }
        });

    } catch (error) {
        console.error('[RouteController] Create route from waypoints error:', error);
        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to create route from waypoints'
        });
    }
}

module.exports = {
    createFromPoints,
    createFromGPX,
    createFromAddresses,
    createFromAddressesWithStops,
    createFromWaypoints,
    getAllRoutes,
    getRoute,
    updateRouteConfig,
    deleteRoute
};

