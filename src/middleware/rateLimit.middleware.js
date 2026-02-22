/**
 * Rate Limiting Middleware
 * Uses Redis sliding-window algorithm.
 *
 * Two variants:
 *  1. rateLimitAddresses  — per authenticated userId (existing, for route creation)
 *  2. createIpRateLimit   — per client IP (new, for login / activate)
 */

const { getRedis } = require('../lib/redis');
const config = require('../config/config');

// ── 1. User-based rate limit (address route creation) ────────────────────────
const RATE_LIMIT_PREFIX = 'ratelimit:addresses:';
const WINDOW_SECONDS = config.RATE_LIMIT_WINDOW || 60;
const MAX_REQUESTS = config.RATE_LIMIT_ADDRESSES || 20;

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
        const now = Math.floor(Date.now() / 1000);
        const windowStart = now - WINDOW_SECONDS;
        const key = `${RATE_LIMIT_PREFIX}${userId}`;

        await redis.zremrangebyscore(key, 0, windowStart);
        const requestCount = await redis.zcard(key);

        if (requestCount >= MAX_REQUESTS) {
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

        await redis.zadd(key, now, `${now}-${Math.random()}`);
        await redis.expire(key, WINDOW_SECONDS);

        res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - requestCount - 1));
        res.setHeader('X-RateLimit-Window', WINDOW_SECONDS);

        next();

    } catch (error) {
        console.error('[RateLimit] Error:', error.message);
        // If Redis fails, allow request — don't block users due to infra issues
        next();
    }
}

// ── 2. IP-based rate limit factory (public endpoints: login, activate) ───────
/**
 * Creates an Express middleware that rate-limits by client IP.
 * @param {number} maxRequests  - Max requests allowed in the window
 * @param {number} windowSecs   - Rolling window in seconds
 * @param {string} prefix       - Redis key prefix (for isolation between endpoints)
 */
function createIpRateLimit(maxRequests, windowSecs, prefix = 'ratelimit:ip:') {
    return async function ipRateLimit(req, res, next) {
        // Respect X-Forwarded-For (set by nginx proxy)
        const clientIp = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
            .toString()
            .split(',')[0]
            .trim();

        try {
            const redis = getRedis();
            const now = Math.floor(Date.now() / 1000);
            const windowStart = now - windowSecs;
            const key = `${prefix}${clientIp}`;

            await redis.zremrangebyscore(key, 0, windowStart);
            const requestCount = await redis.zcard(key);

            if (requestCount >= maxRequests) {
                const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
                const retryAfter = oldest.length > 1
                    ? Math.ceil(parseInt(oldest[1]) + windowSecs - now)
                    : windowSecs;

                return res.status(429).json({
                    success: false,
                    error: 'Too many requests. Try again later.',
                    retryAfter: Math.max(1, retryAfter)
                });
            }

            await redis.zadd(key, now, `${now}-${Math.random()}`);
            await redis.expire(key, windowSecs);

            res.setHeader('X-RateLimit-Limit', maxRequests);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - requestCount - 1));
            res.setHeader('X-RateLimit-Window', windowSecs);

            next();

        } catch (error) {
            console.error('[IpRateLimit] Error:', error.message);
            // If Redis fails, allow request — don't block users due to infra issues
            next();
        }
    };
}

module.exports = rateLimitAddresses;
module.exports.createIpRateLimit = createIpRateLimit;
