/**
 * OpenRouteService (ORS) Client
 * Handles geocoding and directions API calls with Redis caching
 */

const axios = require('axios');
const config = require('../config/config');
const { getRedis } = require('../lib/redis');

const ORS_BASE_URL = config.ORS_API_URL || 'https://api.openrouteservice.org';
const ORS_API_KEY = config.ORS_API_KEY;
const GEOCODING_CACHE_TTL = config.ORS_GEOCODING_CACHE_TTL || 86400; // 24 hours

/**
 * Geocode an address to lat/lng coordinates
 * Uses Redis cache for 24 hours
 * @param {string} addressText - Address to geocode
 * @returns {Promise<{lat: number, lng: number}>}
 * @throws {Error} If geocoding fails or no results found
 */
async function geocodeAddress(addressText) {
    if (!addressText || typeof addressText !== 'string') {
        throw new Error('Address text is required');
    }

    if (!ORS_API_KEY) {
        throw new Error('ORS_API_KEY is not configured');
    }

    // Normalize address for cache key
    const normalizedAddress = addressText.toLowerCase().trim();
    const cacheKey = `ors:geocode:${normalizedAddress}`;

    // Try cache first
    try {
        const redis = getRedis();
        const cached = await redis.get(cacheKey);

        if (cached) {
            console.log(`[ORS] Geocoding cache hit: ${addressText}`);
            return JSON.parse(cached);
        }
    } catch (cacheError) {
        console.warn('[ORS] Redis cache error:', cacheError.message);
        // Continue without cache
    }

    // Call ORS Geocoding API
    try {
        console.log(`[ORS] Geocoding: ${addressText}`);

        const response = await axios.get(`${ORS_BASE_URL}/geocode/search`, {
            headers: {
                'Authorization': ORS_API_KEY,
                'Content-Type': 'application/json'
            },
            params: {
                text: addressText,
                size: 1 // Only return top result
            },
            timeout: 10000 // 10 second timeout
        });

        const features = response.data?.features;

        if (!features || features.length === 0) {
            throw new Error(`No results found for address: ${addressText}`);
        }

        const coordinates = features[0].geometry.coordinates;
        const result = {
            lng: coordinates[0],
            lat: coordinates[1]
        };

        // Cache result
        try {
            const redis = getRedis();
            await redis.setex(cacheKey, GEOCODING_CACHE_TTL, JSON.stringify(result));
            console.log(`[ORS] Cached geocoding result for: ${addressText}`);
        } catch (cacheError) {
            console.warn('[ORS] Failed to cache result:', cacheError.message);
        }

        return result;

    } catch (error) {
        if (error.response) {
            // ORS API error
            const status = error.response.status;
            const message = error.response.data?.error?.message || error.message;

            if (status === 404 || status === 400) {
                throw new Error(`Geocoding failed: ${message}`);
            }

            throw new Error(`ORS API error (${status}): ${message}`);
        }

        // Network or timeout error
        throw new Error(`ORS service unavailable: ${error.message}`);
    }
}

/**
 * Get directions between two coordinates
 * @param {Object} origin - {lat, lng}
 * @param {Object} destination - {lat, lng}
 * @param {string} profile - Routing profile (driving-car, driving-hgv, cycling-regular, etc.)
 * @returns {Promise<{geometry: Array, distanceMeters: number, durationSeconds: number}>}
 * @throws {Error} If directions request fails
 */
async function getDirections(origin, destination, profile = 'driving-car') {
    if (!ORS_API_KEY) {
        throw new Error('ORS_API_KEY is not configured');
    }

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
        throw new Error('Valid origin and destination coordinates required');
    }

    // Validate profile
    const validProfiles = [
        'driving-car', 'driving-hgv', 'cycling-regular',
        'cycling-road', 'cycling-mountain', 'cycling-electric',
        'foot-walking', 'foot-hiking', 'wheelchair'
    ];

    if (!validProfiles.includes(profile)) {
        throw new Error(`Invalid profile: ${profile}. Must be one of: ${validProfiles.join(', ')}`);
    }

    try {
        console.log(`[ORS] Getting directions: ${origin.lat},${origin.lng} -> ${destination.lat},${destination.lng} (${profile})`);

        const response = await axios.post(
            `${ORS_BASE_URL}/v2/directions/${profile}/geojson`,
            {
                coordinates: [
                    [origin.lng, origin.lat],
                    [destination.lng, destination.lat]
                ],
                instructions: false,
                elevation: false
            },
            {
                headers: {
                    'Authorization': ORS_API_KEY,
                    'Content-Type': 'application/json'
                },
                timeout: 15000 // 15 second timeout
            }
        );

        const features = response.data?.features;

        if (!features || features.length === 0) {
            throw new Error('No route found between origin and destination');
        }

        const route = features[0];
        const geometry = route.geometry.coordinates; // Array of [lng, lat]

        // Log response structure for debugging
        console.log('[ORS] Response structure:', JSON.stringify({
            hasProperties: !!route.properties,
            hasSegments: !!route.properties?.segments,
            segmentsLength: route.properties?.segments?.length,
            hasSummary: !!route.properties?.summary
        }));

        // Try segments first, fall back to summary
        const segments = route.properties?.segments;
        let distanceMeters, durationSeconds;

        if (segments && segments.length > 0) {
            distanceMeters = segments[0].distance;
            durationSeconds = segments[0].duration;
        } else if (route.properties?.summary) {
            // Fallback to summary if segments not available
            distanceMeters = route.properties.summary.distance;
            durationSeconds = route.properties.summary.duration;
        } else {
            throw new Error('ORS response missing distance/duration information');
        }

        // Convert geometry from [lng, lat] to {lat, lng}
        const points = geometry.map(coord => ({
            lng: coord[0],
            lat: coord[1]
        }));

        return {
            geometry: points,
            distanceMeters,
            durationSeconds
        };

    } catch (error) {
        if (error.response) {
            // ORS API error
            const status = error.response.status;
            const message = error.response.data?.error?.message || error.message;

            if (status === 404) {
                throw new Error('No route found between the specified locations');
            }

            throw new Error(`ORS API error (${status}): ${message}`);
        }

        // Network or timeout error
        throw new Error(`ORS service unavailable: ${error.message}`);
    }
}

/**
 * Clear geocoding cache for a specific address
 * @param {string} addressText 
 */
async function clearGeocodeCache(addressText) {
    const normalizedAddress = addressText.toLowerCase().trim();
    const cacheKey = `ors:geocode:${normalizedAddress}`;

    try {
        const redis = getRedis();
        await redis.del(cacheKey);
        console.log(`[ORS] Cleared cache for: ${addressText}`);
    } catch (error) {
        console.warn('[ORS] Failed to clear cache:', error.message);
    }
}

/**
 * Autocomplete address suggestions
 * @param {string} query - Search query (minimum 3 characters)
 * @param {number} limit - Maximum number of suggestions (default 6)
 * @param {string} country - Optional country code filter (e.g., 'US', 'DO')
 * @returns {Promise<Array<{label: string, lat: number, lng: number}>>}
 * @throws {Error} If autocomplete fails
 */
async function autocompleteAddress(query, limit = 6, country = null) {
    if (!query || typeof query !== 'string') {
        throw new Error('Query is required');
    }

    if (query.length < 3) {
        throw new Error('Query must be at least 3 characters');
    }

    if (!ORS_API_KEY) {
        throw new Error('ORS_API_KEY is not configured');
    }

    // Normalize query for cache key
    const normalizedQuery = query.toLowerCase().trim();
    const cacheKey = `ors:autocomplete:${normalizedQuery}${country ? ':' + country : ''}`;

    // Try cache first
    try {
        const redis = getRedis();
        const cached = await redis.get(cacheKey);

        if (cached) {
            console.log(`[ORS] Autocomplete cache hit: ${query}`);
            return JSON.parse(cached);
        }
    } catch (cacheError) {
        console.warn('[ORS] Redis cache error:', cacheError.message);
        // Continue without cache
    }

    // Call ORS Autocomplete API
    try {
        console.log(`[ORS] Autocomplete: ${query}${country ? ' (country: ' + country + ')' : ''}`);

        const params = {
            text: query,
            size: Math.min(Math.max(1, limit), 20) // Limit between 1-20
        };

        // Add country boundary if specified
        if (country) {
            params['boundary.country'] = country;
        }

        const response = await axios.get(`${ORS_BASE_URL}/geocode/autocomplete`, {
            headers: {
                'Authorization': ORS_API_KEY,
                'Content-Type': 'application/json'
            },
            params,
            timeout: 10000 // 10 second timeout
        });

        const features = response.data?.features;

        if (!features || features.length === 0) {
            // Return empty array instead of throwing
            console.log(`[ORS] No autocomplete results for: ${query}`);
            return [];
        }

        // Map to simple format
        const suggestions = features.map(feature => ({
            label: feature.properties.label || feature.properties.name,
            lat: feature.geometry.coordinates[1], // ORS uses [lng, lat]
            lng: feature.geometry.coordinates[0]
        }));

        // Cache result
        try {
            const redis = getRedis();
            await redis.setex(cacheKey, GEOCODING_CACHE_TTL, JSON.stringify(suggestions));
            console.log(`[ORS] Cached autocomplete result for: ${query} (${suggestions.length} results)`);
        } catch (cacheError) {
            console.warn('[ORS] Failed to cache autocomplete result:', cacheError.message);
        }

        return suggestions;

    } catch (error) {
        if (error.response) {
            // ORS API error
            const status = error.response.status;
            const message = error.response.data?.error?.message || error.message;

            if (status === 404 || status === 400) {
                // Return empty array for no results
                return [];
            }

            throw new Error(`ORS API error (${status}): ${message}`);
        }

        // Network or timeout error
        throw new Error(`ORS service unavailable: ${error.message}`);
    }
}

/**
 * Get directions for multiple waypoints in a single ORS request
 * @param {Array<{lat: number, lng: number}>} waypoints - Array of 2..N coordinates
 * @param {string} profile - Routing profile
 * @returns {Promise<{geometry: Array, distanceMeters: number, durationSeconds: number}>}
 * @throws {Error} If directions request fails
 */
async function getDirectionsMulti(waypoints, profile = 'driving-car') {
    if (!ORS_API_KEY) {
        throw new Error('ORS_API_KEY is not configured');
    }

    if (!waypoints || waypoints.length < 2) {
        throw new Error('At least 2 waypoints are required');
    }

    // Validate profile
    const validProfiles = [
        'driving-car', 'driving-hgv', 'cycling-regular',
        'cycling-road', 'cycling-mountain', 'cycling-electric',
        'foot-walking', 'foot-hiking', 'wheelchair'
    ];

    if (!validProfiles.includes(profile)) {
        throw new Error(`Invalid profile: ${profile}. Must be one of: ${validProfiles.join(', ')}`);
    }

    // Build coordinates array in ORS format [lng, lat]
    const coordinates = waypoints.map(wp => {
        if (wp.lat == null || wp.lng == null) {
            throw new Error('Each waypoint must have lat and lng');
        }
        return [parseFloat(wp.lng), parseFloat(wp.lat)];
    });

    try {
        console.log(`[ORS] Getting multi-waypoint directions: ${waypoints.length} points (${profile})`);

        const axiosConfig = {
            headers: {
                'Authorization': ORS_API_KEY,
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout for multi-waypoint
        };

        const payload = {
            coordinates,
            instructions: false,
            elevation: false
        };

        let response;
        try {
            response = await axios.post(`${ORS_BASE_URL}/v2/directions/${profile}/geojson`, payload, axiosConfig);
        } catch (initialError) {
            const status = initialError.response?.status;
            if (status === 429 || status >= 500 || initialError.code === 'ECONNABORTED' || initialError.message.includes('timeout')) {
                console.warn(`[ORS] Retrying multi-waypoint due to ${status || 'timeout/network'} after 1000ms`);
                await new Promise(res => setTimeout(res, 1000));
                response = await axios.post(`${ORS_BASE_URL}/v2/directions/${profile}/geojson`, payload, axiosConfig);
            } else {
                throw initialError;
            }
        }

        const features = response.data?.features;

        if (!features || features.length === 0) {
            throw new Error('No route found between the specified waypoints');
        }

        const route = features[0];
        const geometry = route.geometry.coordinates; // Array of [lng, lat]

        // Aggregate distance and duration from all segments
        const segments = route.properties?.segments;
        let distanceMeters = 0;
        let durationSeconds = 0;

        if (segments && segments.length > 0) {
            segments.forEach(seg => {
                distanceMeters += seg.distance || 0;
                durationSeconds += seg.duration || 0;
            });
        } else if (route.properties?.summary) {
            distanceMeters = route.properties.summary.distance;
            durationSeconds = route.properties.summary.duration;
        } else {
            throw new Error('ORS response missing distance/duration information');
        }

        // Convert geometry from [lng, lat] to {lat, lng}
        const points = geometry.map(coord => ({
            lng: coord[0],
            lat: coord[1]
        }));

        console.log(`[ORS] Multi-waypoint route: ${Math.round(distanceMeters)}m, ${Math.round(durationSeconds)}s, ${points.length} raw points`);

        return {
            geometry: points,
            distanceMeters,
            durationSeconds
        };

    } catch (error) {
        if (error.response) {
            const status = error.response.status;
            const message = error.response.data?.error?.message || error.message;

            if (status === 404) {
                throw new Error('No route found between the specified locations');
            }

            throw new Error(`ORS API error (${status}): ${message}`);
        }

        // Network or timeout error
        throw new Error(`ORS service unavailable: ${error.message}`);
    }
}

module.exports = {
    geocodeAddress,
    getDirections,
    getDirectionsMulti,
    clearGeocodeCache,
    autocompleteAddress
};
