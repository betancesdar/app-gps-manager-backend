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

    // Route Safety Gate Constraints
    ROUTE_SAFETY_GATE: process.env.ROUTE_SAFETY_GATE === 'true',
    ROUTE_SIMPLIFY_METERS: Math.max(0, parseFloat(process.env.ROUTE_SIMPLIFY_METERS) || 2),
    ROUTE_RESAMPLE_METERS: Math.max(1, parseFloat(process.env.ROUTE_RESAMPLE_METERS) || 5),
    ROUTE_MAX_SEGMENT_METERS: Math.max(10, parseFloat(process.env.ROUTE_MAX_SEGMENT_METERS) || 200),
    ROUTE_MIN_TOTAL_METERS: Math.max(0, parseFloat(process.env.ROUTE_MIN_TOTAL_METERS) || 50),

    // Advanced Distance Simulator Engine
    STREAM_DISTANCE_ENGINE: process.env.STREAM_DISTANCE_ENGINE === 'true',
    STREAM_TICK_CLAMP_MIN_MS: Math.max(50, parseInt(process.env.STREAM_TICK_CLAMP_MIN_MS) || 200),
    STREAM_TICK_CLAMP_MAX_MS: Math.max(500, parseInt(process.env.STREAM_TICK_CLAMP_MAX_MS) || 2000),

    // Stream defaults
    STREAM_DEFAULTS: {
        speed: parseFloat(process.env.STREAM_DEFAULT_SPEED) || 30,     // km/h
        accuracy: parseFloat(process.env.STREAM_DEFAULT_ACCURACY) || 5, // meters
        intervalMs: parseInt(process.env.STREAM_TICK_MS) || 1000, // Default 1000ms — stable for 13+ devices through Cloudflare (override via STREAM_TICK_MS=500 if desired)
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

    // Stream WS Backpressure
    STREAM_WS_BACKPRESSURE_ENABLED: process.env.STREAM_WS_BACKPRESSURE_ENABLED === 'true',
    STREAM_WS_BUFFERED_MAX_BYTES: parseInt(process.env.STREAM_WS_BUFFERED_MAX_BYTES) || 262144, // 256KB
    STREAM_WS_TCP_MAX_BYTES: parseInt(process.env.STREAM_WS_TCP_MAX_BYTES) || 524288,           // 512KB
    STREAM_WS_PRESSURE_STRIKES_TO_PAUSE: parseInt(process.env.STREAM_WS_PRESSURE_STRIKES_TO_PAUSE) || 10,
    STREAM_WS_PRESSURE_WINDOW_MS: parseInt(process.env.STREAM_WS_PRESSURE_WINDOW_MS) || 15000,
};
