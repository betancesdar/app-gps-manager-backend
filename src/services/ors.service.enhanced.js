/**
 * Enhanced ORS Service
 * OpenRouteService integration with smart caching and Redis
 */

const axios = require('axios');
const config = require('../config/config');
const { redis } = require('../lib/redis');
const logger = require('../lib/logger');
const metrics = require('../lib/metrics');

const ORS_API_URL = config.ORS_API_URL;
const ORS_API_KEY = config.ORS_API_KEY;
const CACHE_TTL = config.ORS_GEOCODING_CACHE_TTL; // 24 hours default

// Create axios instance with timeout
const orsClient = axios.create({
  baseURL: ORS_API_URL,
  timeout: 10000,
  headers: {
    Authorization: ORS_API_KEY,
  },
});

/**
 * Generate cache key for geocoding results
 * @param {string} query - Search query
 * @returns {string} Cache key
 */
function generateCacheKey(query) {
  return `ors:geocode:${query.toLowerCase()}`;
}

/**
 * Geocode an address using ORS with caching
 * @param {string} address - Address to geocode
 * @returns {Promise<Object>} { lat, lng, full_address, ...}
 */
async function geocodeAddress(address) {
  try {
    if (!address || typeof address !== 'string') {
      throw new Error('Address must be a non-empty string');
    }

    const trimmedAddress = address.trim();
    if (trimmedAddress.length === 0) {
      throw new Error('Address cannot be empty');
    }

    const cacheKey = generateCacheKey(trimmedAddress);

    // 1. Check Redis cache first
    const cachedResult = await redis.get(cacheKey);
    if (cachedResult) {
      metrics.cacheHits.labels('geocoding').inc();
      logger.debug('Geocoding cache hit', { address: trimmedAddress });
      return JSON.parse(cachedResult);
    }

    metrics.cacheMisses.labels('geocoding').inc();
    logger.debug('Geocoding cache miss', { address: trimmedAddress });

    // 2. Call ORS API
    const response = await orsClient.get('/geocode/search', {
      params: {
        text: trimmedAddress,
        limit: 1,
      },
    });

    // Validate response
    if (!response.data || !response.data.features || response.data.features.length === 0) {
      logger.warn('ORS geocoding returned no results', { address: trimmedAddress });
      return null;
    }

    // Extract coordinates from GeoJSON
    const feature = response.data.features[0];
    const [lng, lat] = feature.geometry.coordinates;
    const properties = feature.properties || {};

    const result = {
      lat,
      lng,
      full_address: properties.label || trimmedAddress,
      confidence: properties.confidence || null,
      place_name: properties.name || null,
    };

    // 3. Cache in Redis
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result));
    logger.info('Geocoding result cached', {
      address: trimmedAddress,
      lat,
      lng,
      ttl: CACHE_TTL,
    });

    return result;
  } catch (error) {
    logger.error('Geocoding error', {
      address,
      error: error.message,
      status: error.response?.status,
    });
    metrics.errors.inc({ type: 'geocoding', severity: 'medium' });
    throw error;
  }
}

/**
 * Reverse geocode coordinates
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {Promise<string>} Address string
 */
async function reverseGeocode(lat, lng) {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error('Invalid latitude or longitude');
    }

    // Check valid ranges
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('Coordinates out of valid range');
    }

    const cacheKey = `ors:reverse:${lat},${lng}`;

    // Check cache
    const cachedResult = await redis.get(cacheKey);
    if (cachedResult) {
      metrics.cacheHits.labels('reverse_geocoding').inc();
      logger.debug('Reverse geocoding cache hit', { lat, lng });
      return cachedResult;
    }

    metrics.cacheMisses.labels('reverse_geocoding').inc();

    // Call ORS API
    const response = await orsClient.get('/geocode/reverse', {
      params: {
        point: {
          lat,
          lng,
        },
        limit: 1,
      },
    });

    if (!response.data || !response.data.features || response.data.features.length === 0) {
      logger.warn('ORS reverse geocoding returned no results', { lat, lng });
      return null;
    }

    const address = response.data.features[0].properties?.label || 'Unknown Location';

    // Cache result
    await redis.setex(cacheKey, CACHE_TTL, address);

    return address;
  } catch (error) {
    logger.error('Reverse geocoding error', {
      lat,
      lng,
      error: error.message,
    });
    metrics.errors.inc({ type: 'reverse_geocoding', severity: 'medium' });
    throw error;
  }
}

/**
 * Get route between two points
 * @param {Array} coordinates - Array of [lng, lat] pairs
 * @param {string} profile - Routing profile (driving-car, foot-walking, cycling-regular)
 * @returns {Promise<Object>} Route with distance, duration, geometry
 */
async function getRoute(coordinates, profile = 'driving-car') {
  try {
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      throw new Error('Route requires at least 2 coordinate pairs');
    }

    // Validate all coordinates
    const validCoords = coordinates.every(([lng, lat]) => {
      if (typeof lng !== 'number' || typeof lat !== 'number') {
        return false;
      }
      return (
        lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
      );
    });

    if (!validCoords) {
      throw new Error('Invalid coordinates in route');
    }

    const cacheKey = `ors:route:${profile}:${coordinates.join('|')}`;

    // Check cache
    const cachedResult = await redis.get(cacheKey);
    if (cachedResult) {
      metrics.cacheHits.labels('routing').inc();
      return JSON.parse(cachedResult);
    }

    metrics.cacheMisses.labels('routing').inc();

    // Call ORS API
    const response = await orsClient.post(`/v2/directions/${profile}/geojson`, {
      coordinates,
      format: 'geojson',
    });

    if (!response.data || !response.data.features || response.data.features.length === 0) {
      throw new Error('No route found');
    }

    const route = response.data.features[0];
    const result = {
      distance: route.properties?.summary?.distance || 0,
      duration: route.properties?.summary?.duration || 0,
      geometry: route.geometry,
      coordinates: route.geometry?.coordinates || [],
    };

    // Cache result (shorter TTL for routes)
    await redis.setex(cacheKey, 3600, JSON.stringify(result)); // 1 hour

    logger.info('Route calculated and cached', {
      profile,
      distance: result.distance,
      duration: result.duration,
    });

    return result;
  } catch (error) {
    logger.error('Routing error', {
      profile,
      error: error.message,
      status: error.response?.status,
    });
    metrics.errors.inc({ type: 'routing', severity: 'medium' });
    throw error;
  }
}

/**
 * Clear geocoding cache for a specific address or all
 * @param {string} address - Specific address to clear, or null for all
 */
async function clearCache(address = null) {
  try {
    if (address) {
      const cacheKey = generateCacheKey(address);
      await redis.del(cacheKey);
      logger.info('Cache cleared for address', { address });
    } else {
      // Clear all ORS-related cache
      const pattern = 'ors:*';
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      logger.info('All ORS cache cleared', { keys_deleted: keys.length });
    }
  } catch (error) {
    logger.error('Cache clear error', { error: error.message });
  }
}

/**
 * Get cache statistics
 */
async function getCacheStats() {
  try {
    const pattern = 'ors:*';
    const keys = await redis.keys(pattern);
    const stats = {
      total_keys: keys.length,
      geocode_keys: keys.filter((k) => k.includes('geocode')).length,
      reverse_keys: keys.filter((k) => k.includes('reverse')).length,
      route_keys: keys.filter((k) => k.includes('route')).length,
    };
    return stats;
  } catch (error) {
    logger.error('Cache stats error', { error: error.message });
    return null;
  }
}

module.exports = {
  geocodeAddress,
  reverseGeocode,
  getRoute,
  clearCache,
  getCacheStats,
};
