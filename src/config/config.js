/**
 * Application Configuration
 * Centralized configuration for the GPS Mock Location Backend
 * Supports both local development and Docker deployment
 */

const isProd = (process.env.NODE_ENV || 'development') === 'production';

// ── Production guards ────────────────────────────────────────────────────────
if (isProd && !process.env.JWT_SECRET) {
    console.error('❌ FATAL: JWT_SECRET environment variable is required in production.');
    process.exit(1);
}

module.exports = {
    // Server
    PORT: process.env.PORT || 4000,
    NODE_ENV: process.env.NODE_ENV || 'development',

    // Database (PostgreSQL)
    DATABASE_URL: process.env.DATABASE_URL,

    // Redis
    REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',

    // JWT
    JWT_SECRET: process.env.JWT_SECRET || 'default_jwt_secret_change_me_in_dev',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

    // Default admin credentials (for first-run seeding)
    DEFAULT_ADMIN_PASSWORD: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',

    // CORS
    // Comma-separated list of allowed origins.
    // Example: https://admin.trustygps.app,http://localhost:8547
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
        : ['http://localhost:8547', 'http://localhost:3000'],

    // Redis TTLs (seconds)
    WS_AUTH_TTL: parseInt(process.env.WS_AUTH_TTL) || 900,      // 15 minutes
    WS_CONN_TTL: parseInt(process.env.WS_CONN_TTL) || 120,      // 2 minutes

    // Stream defaults
    STREAM_DEFAULTS: {
        speed: parseFloat(process.env.STREAM_DEFAULT_SPEED) || 30,     // km/h
        accuracy: parseFloat(process.env.STREAM_DEFAULT_ACCURACY) || 5, // meters
        intervalMs: parseInt(process.env.STREAM_TICK_MS) || 1000,       // emit every N ms
        loop: process.env.STREAM_DEFAULT_LOOP === 'true' || false
    },

    // OpenRouteService (ORS)
    ORS_API_KEY: process.env.ORS_API_KEY || '',
    ORS_API_URL: process.env.ORS_API_URL || 'https://api.openrouteservice.org',
    ORS_GEOCODING_CACHE_TTL: parseInt(process.env.ORS_GEOCODING_CACHE_TTL) || 86400, // 24 hours
    ORS_DEFAULT_POINT_SPACING: parseInt(process.env.ORS_DEFAULT_POINT_SPACING) || 15, // meters

    // Rate Limiting — address-based route creation (authenticated users)
    RATE_LIMIT_ADDRESSES: parseInt(process.env.RATE_LIMIT_ADDRESSES) || 20, // requests per minute
    RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW) || 60, // seconds

    // Rate Limiting — unauthenticated endpoints (by IP)
    RATE_LIMIT_LOGIN_MAX: parseInt(process.env.RATE_LIMIT_LOGIN_MAX) || 10,       // per minute
    RATE_LIMIT_ACTIVATE_MAX: parseInt(process.env.RATE_LIMIT_ACTIVATE_MAX) || 30, // per minute
    RATE_LIMIT_IP_WINDOW: parseInt(process.env.RATE_LIMIT_IP_WINDOW) || 60,       // seconds
};
