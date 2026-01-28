/**
 * Application Configuration
 * Centralized configuration for the GPS Mock Location Backend
 */

module.exports = {
    // Server
    PORT: process.env.PORT || 4000,
    
    // JWT
    JWT_SECRET: process.env.JWT_SECRET || 'default_jwt_secret_change_me',
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
    
    // Default credentials (for simple auth - replace with DB in production)
    DEFAULT_USER: {
        username: 'admin',
        password: 'admin123'
    },
    
    // Stream defaults
    STREAM_DEFAULTS: {
        speed: 30,           // km/h
        accuracy: 5,         // meters
        intervalMs: 1000,    // emit every 1 second
        loop: false
    }
};
