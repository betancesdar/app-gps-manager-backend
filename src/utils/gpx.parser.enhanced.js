/**
 * Enhanced GPX Parser with Validation
 * Handles GPX file parsing with strict error checking
 */

const fs = require('fs');
const metrics = require('../lib/metrics');
const logger = require('../lib/logger');

/**
 * Validate GPX content structure
 * @param {string} gpxContent - Raw GPX XML content
 * @returns {Object} { valid: boolean, error: string|null }
 */
function validateGPXStructure(gpxContent) {
  if (!gpxContent || typeof gpxContent !== 'string') {
    return { valid: false, error: 'GPX content must be a non-empty string' };
  }

  if (!gpxContent.includes('<gpx')) {
    return { valid: false, error: 'Invalid GPX: missing <gpx> root element' };
  }

  if (!gpxContent.includes('</gpx>')) {
    return { valid: false, error: 'Invalid GPX: missing closing </gpx> tag' };
  }

  // Check for required namespaces or at least version
  if (!gpxContent.includes('version=')) {
    metrics.gpxParseErrors.inc({ reason: 'missing_version' });
    return { valid: false, error: 'GPX must have version attribute' };
  }

  return { valid: true, error: null };
}

/**
 * Extract track points from GPX
 * @param {string} gpxContent - Raw GPX XML content
 * @returns {Array} Array of { lat, lng, alt?, time? }
 */
function extractTrackPoints(gpxContent) {
  const points = [];
  const trackPointRegex
    = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>([^<]*)<\/trkpt>/g;

  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = trackPointRegex.exec(gpxContent))) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);

    // Validate coordinates
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      metrics.gpxParseErrors.inc({ reason: 'invalid_coordinates' });
      logger.warn('Invalid coordinates in GPX', { lat, lng });
      continue;
    }

    // Check coordinate ranges
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      metrics.gpxParseErrors.inc({ reason: 'coordinates_out_of_range' });
      logger.warn('Coordinates out of valid range', { lat, lng });
      continue;
    }

    points.push({ lat, lng });
  }

  return points;
}

/**
 * Extract waypoints from GPX
 * @param {string} gpxContent - Raw GPX XML content
 * @returns {Array} Array of { lat, lng, name? }
 */
function extractWaypoints(gpxContent) {
  const waypoints = [];
  const waypointRegex
    = /<wpt\s+lat="([^"]+)"\s+lon="([^"]+)"[^>]*>(?:<name>([^<]*)<\/name>)?[^<]*<\/wpt>/g;

  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = waypointRegex.exec(gpxContent))) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    const name = match[3] || null;

    // Validate coordinates
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      metrics.gpxParseErrors.inc({ reason: 'invalid_waypoint_coordinates' });
      continue;
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      metrics.gpxParseErrors.inc({ reason: 'waypoint_out_of_range' });
      continue;
    }

    waypoints.push({ lat, lng, name });
  }

  return waypoints;
}

/**
 * Main parser function with full validation
 * @param {string} gpxContent - Raw GPX XML content
 * @returns {Object} { success: boolean, points: Array, waypoints: Array, error: string|null }
 */
function parseGPX(gpxContent) {
  try {
    // Step 1: Validate structure
    const validation = validateGPXStructure(gpxContent);
    if (!validation.valid) {
      metrics.gpxParseErrors.inc({ reason: 'structure_validation_failed' });
      logger.warn('GPX structure validation failed', {
        error: validation.error,
      });
      return {
        success: false,
        points: [],
        waypoints: [],
        error: validation.error,
      };
    }

    // Step 2: Extract track points
    const points = extractTrackPoints(gpxContent);
    if (points.length === 0) {
      metrics.gpxParseErrors.inc({ reason: 'no_track_points_found' });
      logger.warn('No track points found in GPX');
      return {
        success: false,
        points: [],
        waypoints: [],
        error: 'No track points found in GPX file',
      };
    }

    // Step 3: Extract waypoints (optional)
    const waypoints = extractWaypoints(gpxContent);

    logger.info('GPX parsed successfully', {
      points_count: points.length,
      waypoints_count: waypoints.length,
    });
    metrics.dataPoints.inc({ source: 'gpx' }, points.length);

    return {
      success: true,
      points,
      waypoints,
      error: null,
    };
  } catch (error) {
    metrics.gpxParseErrors.inc({ reason: 'parse_exception' });
    logger.error('GPX parsing exception', { error: error.message });
    return {
      success: false,
      points: [],
      waypoints: [],
      error: `GPX parsing failed: ${error.message}`,
    };
  }
}

module.exports = {
  parseGPX,
  validateGPXStructure,
  extractTrackPoints,
  extractWaypoints,
};
