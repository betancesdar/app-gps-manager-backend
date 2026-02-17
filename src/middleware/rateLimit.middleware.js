/**
 * Rate Limiting Middleware
 * Uses Redis to enforce per-user rate limits
 */

const { getRedis } = require('../lib/redis');
const config = require('../config/config');

const RATE_LIMIT_PREFIX = 'ratelimit:addresses:';
const WINDOW_SECONDS = config.RATE_LIMIT_WINDOW || 60;
const MAX_REQUESTS = config.RATE_LIMIT_ADDRESSES || 20;

/**
 * Rate limiting middleware for address-based route creation
 * Limits requests per user per time window
 */
async function rateLimitAddresses(req, res, next) {
    const userId = req.user?.userId;

    if (!userId) {
        return res.status(401).json({
            success: false,
            error: 'User not authenticated'
        });
    }

    try {
        const redis = getRedis();
        const now = Math.floor(Date.now() / 1000); // Current time in seconds
        const windowStart = now - WINDOW_SECONDS;

        // Create key with current window
        const key = `${RATE_LIMIT_PREFIX}${userId}`;

        // Use sorted set to track request timestamps
        // Remove old entries outside the window
        await redis.zremrangebyscore(key, 0, windowStart);

        // Count requests in current window
        const requestCount = await redis.zcard(key);

        if (requestCount >= MAX_REQUESTS) {
            // Get TTL to tell user when they can retry
            const oldestTimestamp = await redis.zrange(key, 0, 0, 'WITHSCORES');
            const retryAfter = oldestTimestamp.length > 1
                ? Math.ceil(parseInt(oldestTimestamp[1]) + WINDOW_SECONDS - now)
                : WINDOW_SECONDS;

            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded. Try again later.',
                retryAfter: Math.max(1, retryAfter)
            });
        }

        // Add current request
        await redis.zadd(key, now, `${now}-${Math.random()}`);

        // Set expiry on the key
        await redis.expire(key, WINDOW_SECONDS);

        // Add rate limit headers
        res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - requestCount - 1));
        res.setHeader('X-RateLimit-Window', WINDOW_SECONDS);

        next();

    } catch (error) {
        console.error('[RateLimit] Error:', error.message);

        // If Redis fails, allow request but log the error
        // Don't block users due to infrastructure issues
        console.warn('[RateLimit] Allowing request due to Redis error');
        next();
    }
}

module.exports = rateLimitAddresses;
