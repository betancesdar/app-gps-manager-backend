/**
 * Geocode Controller
 * Handles address autocomplete using OpenRouteService
 */

const orsService = require('../services/ors.service');

/**
 * GET /api/geocode/autocomplete
 * Get address suggestions based on query
 */
async function autocomplete(req, res) {
    try {
        const { q, limit, country } = req.query;

        // Validate query parameter
        if (!q) {
            return res.status(400).json({
                success: false,
                message: 'Query parameter "q" is required'
            });
        }

        if (q.length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Query must be at least 3 characters'
            });
        }

        // Parse limit (default 6, max 20)
        const suggestionLimit = limit ? Math.min(Math.max(1, parseInt(limit)), 20) : 6;

        console.log(`[GeocodeController] Autocomplete request: "${q}" (limit: ${suggestionLimit}${country ? ', country: ' + country : ''})`);

        // Call ORS autocomplete service
        const suggestions = await orsService.autocompleteAddress(q, suggestionLimit, country || null);

        return res.status(200).json({
            success: true,
            data: {
                suggestions
            }
        });

    } catch (error) {
        console.error('[GeocodeController] Autocomplete error:', error);

        // Handle specific errors
        if (error.message.includes('ORS_API_KEY')) {
            return res.status(500).json({
                success: false,
                message: 'Geocoding service not configured'
            });
        }

        if (error.message.includes('unavailable')) {
            return res.status(502).json({
                success: false,
                message: 'Geocoding service temporarily unavailable'
            });
        }

        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to get address suggestions'
        });
    }
}

module.exports = {
    autocomplete
};
