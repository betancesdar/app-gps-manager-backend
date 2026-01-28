/**
 * GPX Parser Utility
 * Parses GPX files and extracts coordinates (lat, lng only)
 */

/**
 * Parse GPX content and extract coordinates
 * Only extracts lat, lng (ignores elevation and time as per requirements)
 * @param {string} gpxContent - Raw GPX XML content
 * @returns {Array} Array of {lat, lng} objects
 */
function parseGPX(gpxContent) {
    const points = [];

    // Match trackpoints (<trkpt>) or waypoints (<wpt>)
    const trkptRegex = /<trkpt[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>/gi;
    const wptRegex = /<wpt[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>/gi;
    const rteptRegex = /<rtept[^>]*lat=["']([^"']+)["'][^>]*lon=["']([^"']+)["'][^>]*>/gi;

    // Alternative format where lat/lon are in different order
    const altTrkptRegex = /<trkpt[^>]*lon=["']([^"']+)["'][^>]*lat=["']([^"']+)["'][^>]*>/gi;

    let match;

    // Extract trackpoints
    while ((match = trkptRegex.exec(gpxContent)) !== null) {
        points.push({
            lat: parseFloat(match[1]),
            lng: parseFloat(match[2])
        });
    }

    // Extract waypoints
    while ((match = wptRegex.exec(gpxContent)) !== null) {
        points.push({
            lat: parseFloat(match[1]),
            lng: parseFloat(match[2])
        });
    }

    // Extract route points
    while ((match = rteptRegex.exec(gpxContent)) !== null) {
        points.push({
            lat: parseFloat(match[1]),
            lng: parseFloat(match[2])
        });
    }

    // Alternative format (lon first)
    while ((match = altTrkptRegex.exec(gpxContent)) !== null) {
        points.push({
            lat: parseFloat(match[2]),
            lng: parseFloat(match[1])
        });
    }

    return points;
}

/**
 * Validate coordinates array
 * @param {Array} points - Array of {lat, lng}
 * @returns {boolean} Valid or not
 */
function validateCoordinates(points) {
    if (!Array.isArray(points) || points.length === 0) {
        return false;
    }

    return points.every(point => {
        const lat = parseFloat(point.lat);
        const lng = parseFloat(point.lng);

        return !isNaN(lat) && !isNaN(lng) &&
            lat >= -90 && lat <= 90 &&
            lng >= -180 && lng <= 180;
    });
}

/**
 * Calculate bearing between two points
 * @param {Object} from - {lat, lng}
 * @param {Object} to - {lat, lng}
 * @returns {number} Bearing in degrees (0-360)
 */
function calculateBearing(from, to) {
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;
    const dLng = (to.lng - from.lng) * Math.PI / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

    let bearing = Math.atan2(y, x) * 180 / Math.PI;
    bearing = (bearing + 360) % 360;

    return Math.round(bearing);
}

/**
 * Calculate distance between two points in meters (Haversine formula)
 * @param {Object} from - {lat, lng}
 * @param {Object} to - {lat, lng}
 * @returns {number} Distance in meters
 */
function calculateDistance(from, to) {
    const R = 6371000; // Earth radius in meters
    const lat1 = from.lat * Math.PI / 180;
    const lat2 = to.lat * Math.PI / 180;
    const dLat = (to.lat - from.lat) * Math.PI / 180;
    const dLng = (to.lng - from.lng) * Math.PI / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

module.exports = {
    parseGPX,
    validateCoordinates,
    calculateBearing,
    calculateDistance
};
