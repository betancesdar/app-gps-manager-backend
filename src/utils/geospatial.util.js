/**
 * Geospatial Utilities
 * Haversine distance, bearing calculation, and point resampling for GPS routes
 */

const EARTH_RADIUS_METERS = 6371000; // Earth's radius in meters

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @param {Object} p1 - First point {lat, lng}
 * @param {Object} p2 - Second point {lat, lng}
 * @returns {number} Distance in meters
 */
function calculateDistance(p1, p2) {
    const lat1Rad = toRadians(p1.lat);
    const lat2Rad = toRadians(p2.lat);
    const deltaLat = toRadians(p2.lat - p1.lat);
    const deltaLng = toRadians(p2.lng - p1.lng);

    const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(lat1Rad) * Math.cos(lat2Rad) *
        Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = EARTH_RADIUS_METERS * c;

    return distance;
}

/**
 * Calculate bearing (direction) between two GPS coordinates
 * @param {Object} p1 - Start point {lat, lng}
 * @param {Object} p2 - End point {lat, lng}
 * @returns {number} Bearing in degrees (0-360)
 */
function calculateBearing(p1, p2) {
    const lat1Rad = toRadians(p1.lat);
    const lat2Rad = toRadians(p2.lat);
    const deltaLng = toRadians(p2.lng - p1.lng);

    const y = Math.sin(deltaLng) * Math.cos(lat2Rad);
    const x =
        Math.cos(lat1Rad) * Math.sin(lat2Rad) -
        Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLng);

    const bearing = toDegrees(Math.atan2(y, x));
    return (bearing + 360) % 360; // Normalize to 0-360
}

/**
 * Interpolate a point between two coordinates at a given fraction
 * @param {Object} p1 - Start point {lat, lng}
 * @param {Object} p2 - End point {lat, lng}
 * @param {number} fraction - Fraction between 0 and 1
 * @returns {Object} Interpolated point {lat, lng}
 */
function interpolatePoint(p1, p2, fraction) {
    const lat = p1.lat + (p2.lat - p1.lat) * fraction;
    const lng = p1.lng + (p2.lng - p1.lng) * fraction;
    return { lat, lng };
}

/**
 * Resample array of GPS points to have uniform spacing
 * @param {Array} points - Array of {lat, lng} points
 * @param {number} spacingMeters - Desired spacing between points in meters
 * @returns {Array} Resampled points with approximately uniform spacing
 */
function resamplePoints(points, spacingMeters = 15) {
    if (!points || points.length < 2) {
        return points;
    }

    if (spacingMeters <= 0) {
        throw new Error('Spacing must be greater than 0');
    }

    const resampled = [points[0]]; // Always keep first point
    let distanceFromLast = 0;

    for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        const curr = points[i];
        const segmentDistance = calculateDistance(prev, curr);

        // If this is the last point, always add it
        if (i === points.length - 1) {
            resampled.push(curr);
            break;
        }

        // Accumulate distance and add intermediate points if needed
        let remainingDistance = segmentDistance;
        let segmentStart = prev;

        while (distanceFromLast + remainingDistance >= spacingMeters) {
            // Calculate how far along this segment to place the next point
            const neededDistance = spacingMeters - distanceFromLast;
            const fraction = neededDistance / calculateDistance(segmentStart, curr);

            const newPoint = interpolatePoint(segmentStart, curr, fraction);
            resampled.push(newPoint);

            // Update tracking variables
            remainingDistance -= neededDistance;
            distanceFromLast = 0;
            segmentStart = newPoint;
        }

        distanceFromLast += remainingDistance;
    }

    return resampled;
}

/**
 * Calculate total route distance
 * @param {Array} points - Array of {lat, lng} points
 * @returns {number} Total distance in meters
 */
function calculateRouteDistance(points) {
    if (!points || points.length < 2) {
        return 0;
    }

    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
        totalDistance += calculateDistance(points[i - 1], points[i]);
    }

    return totalDistance;
}

/**
 * Convert degrees to radians
 * @param {number} degrees 
 * @returns {number}
 */
function toRadians(degrees) {
    return degrees * Math.PI / 180;
}

/**
 * Convert radians to degrees
 * @param {number} radians 
 * @returns {number}
 */
function toDegrees(radians) {
    return radians * 180 / Math.PI;
}

module.exports = {
    calculateDistance,
    calculateBearing,
    interpolatePoint,
    resamplePoints,
    calculateRouteDistance
};
