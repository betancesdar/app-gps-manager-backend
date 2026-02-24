/**
 * Route Safety Gate Service
 * Protects database from invalid, microscopic, duplicated, or spiky routes.
 */

const { calculateDistance, calculateBearing, resamplePoints } = require('../utils/geospatial.util');

function sanitizePoints(points) {
    if (!points || !Array.isArray(points) || points.length === 0) return [];

    const cleaned = [];
    for (let i = 0; i < points.length; i++) {
        const p = points[i];

        // Validate bounds
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') continue;
        if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) continue;

        if (cleaned.length === 0) {
            cleaned.push(p);
            continue;
        }

        const prev = cleaned[cleaned.length - 1];

        // Remove exact duplicates
        if (p.lat === prev.lat && p.lng === prev.lng) {
            // Merge attributes if exact duplicate removed
            prev.dwellSeconds = (prev.dwellSeconds || 0) + (p.dwellSeconds || 0);
            if (p.label && !prev.label) prev.label = p.label;
            continue;
        }

        // Remove microscopic segments (< 0.5 meters)
        const dist = calculateDistance(prev, p);
        if (dist < 0.5) {
            prev.dwellSeconds = (prev.dwellSeconds || 0) + (p.dwellSeconds || 0);
            if (p.label && !prev.label) prev.label = p.label;
            continue;
        }

        cleaned.push(p);
    }
    return cleaned;
}

function validatePoints(points, config) {
    if (!points || points.length < 2) {
        throw new Error("INVALID_ROUTE_GEOMETRY");
    }

    let totalMeters = 0;
    const minTotalMeters = config.ROUTE_MIN_TOTAL_METERS || 50;
    const maxSegmentMeters = config.ROUTE_MAX_SEGMENT_METERS || 200;

    for (let i = 1; i < points.length; i++) {
        const segDist = calculateDistance(points[i - 1], points[i]);
        if (segDist > maxSegmentMeters) {
            throw new Error(`INVALID_ROUTE_GEOMETRY: Segment too long (${Math.round(segDist)}m > ${maxSegmentMeters}m)`);
        }
        totalMeters += segDist;
    }

    if (totalMeters < minTotalMeters) {
        throw new Error(`INVALID_ROUTE_GEOMETRY: Route too short (${Math.round(totalMeters)}m < ${minTotalMeters}m)`);
    }
}

function pointSegmentDistance(p, a, b) {
    const dAB = calculateDistance(a, b);
    if (dAB === 0) return calculateDistance(p, a);

    const dAP = calculateDistance(a, p);
    const dBP = calculateDistance(b, p);

    if (dBP * dBP > dAP * dAP + dAB * dAB) return dAP;
    if (dAP * dAP > dBP * dBP + dAB * dAB) return dBP;

    const s = (dAB + dAP + dBP) / 2;
    const MathErrorGuard = s * (s - dAB) * (s - dAP) * (s - dBP);
    if (MathErrorGuard <= 0) return 0;

    return (2 * Math.sqrt(MathErrorGuard)) / dAB;
}

function simplifyPoints(points, toleranceMeters) {
    if (!points || points.length <= 2) return points;

    let dmax = 0;
    let index = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i];

        let d = 0;
        // Protect important points from being simplified away
        if (p.dwellSeconds > 0 || p.label) {
            d = Infinity;
        } else {
            d = pointSegmentDistance(p, first, last);
        }

        if (d > dmax) {
            index = i;
            dmax = d;
        }
    }

    if (dmax > toleranceMeters) {
        const recResults1 = simplifyPoints(points.slice(0, index + 1), toleranceMeters);
        const recResults2 = simplifyPoints(points.slice(index), toleranceMeters);
        return recResults1.slice(0, -1).concat(recResults2);
    } else {
        return [first, last];
    }
}

function resampleByDistance(points, stepMeters) {
    // Rely on existing geospatial utils
    const resampled = resamplePoints(points, stepMeters);
    // Note: Our `resamplePoints` currently does not preserve dwellSeconds since it creates new interpolated points.
    // The user strictly asked not to rewrite the existing function. 
    // They asked for: "resampleByDistance(points, stepMeters) generar puntos interpolados usar haversine existente (NO duplicar función)"
    return resampled;
}

function detectSpikes(points) {
    if (!points || points.length < 3) return;

    const spikes = [];

    for (let i = 1; i < points.length - 1; i++) {
        const p0 = points[i - 1];
        const p1 = points[i];
        const p2 = points[i + 1];

        const seg1Dist = calculateDistance(p0, p1);
        const seg2Dist = calculateDistance(p1, p2);

        // Spike if segmentLength < 5m AND abs(turnAngle) > 160°
        if (seg1Dist < 5 || seg2Dist < 5) {
            const bearing1 = calculateBearing(p0, p1);
            const bearing2 = calculateBearing(p1, p2);

            let turnAngle = Math.abs(bearing2 - bearing1);
            if (turnAngle > 180) turnAngle = 360 - turnAngle;

            if (turnAngle > 160) {
                spikes.push({ index: i, point: p1 });
            }
        }
    }

    // Check if >=3 spikes within 30m window
    if (spikes.length >= 3) {
        for (let i = 0; i < spikes.length - 2; i++) {
            const spikeA = spikes[i];
            const spikeC = spikes[i + 2];

            let distBetween = 0;
            for (let j = spikeA.index; j < spikeC.index; j++) {
                distBetween += calculateDistance(points[j], points[j + 1]);
            }

            if (distBetween <= 30) {
                throw new Error("INVALID_ROUTE_SPIKES");
            }
        }
    }
}

module.exports = {
    sanitizePoints,
    validatePoints,
    simplifyPoints,
    resampleByDistance,
    detectSpikes
};
