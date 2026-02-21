/**
 * Example: How to Use Winston Logger Throughout the Project
 * Replace console.log with logger calls
 */

// ============================================================
// BEFORE (Old console.log style)
// ============================================================

// In controllers/auth.controller.js
console.log('User login attempt:', username);
console.error('Login error:', error.message);

// In services/device.service.js
console.log('Device registered:', deviceId);
console.warn('Device not found');

// In websocket/ws.server.js
console.log('WebSocket connected:', deviceId);

// ============================================================
// AFTER (New Winston logger style)
// ============================================================

const logger = require('../lib/logger');

// =========== BASIC USAGE ===========
logger.info('User login attempt', { username, ip: req.ip });
logger.error('Login error', { error: error.message });

logger.info('Device registered', { deviceId, userId });
logger.warn('Device not found', { deviceId, userId });

logger.info('WebSocket connected', { deviceId, clientType, ip });

// =========== LOG LEVELS ===========
logger.debug('Detailed debug info', { key: 'value' });           // Development only
logger.info('General information', { action: 'created' });       // Normal operations
logger.warn('Warning message', { reason: 'deprecated' });        // Unexpected but handled
logger.error('Error message', { error: error.message });         // Error occurred

// =========== STRUCTURED LOGGING ===========
// Always include context as second parameter (object)

// ❌ BAD
logger.info('User with ID 123 logged in from 192.168.1.1');

// ✅ GOOD
logger.info('User logged in', {
  userId: '123',
  ip: '192.168.1.1',
  timestamp: new Date().toISOString(),
});

// =========== TYPES OF INFORMATION ===========

// 1. Authentication Events
logger.info('Authentication success', {
  userId: user.id,
  username: user.username,
  ip: req.ip,
  method: 'password',
});

logger.warn('Authentication failed', {
  username: req.body.username,
  reason: 'invalid_credentials',
  ip: req.ip,
});

// 2. Database Operations
logger.info('Database query executed', {
  operation: 'SELECT',
  table: 'users',
  duration_ms: 45,
});

logger.error('Database error', {
  operation: 'INSERT',
  table: 'routes',
  error: error.message,
});

// 3. WebSocket Events
logger.info('WebSocket connected', {
  client_id: ws.clientId,
  device_id: deviceId,
  client_type: 'device',
  ip: clientIp,
});

logger.warn('WebSocket auth failed', {
  device_id: deviceId,
  reason: 'invalid_token',
  ip: clientIp,
});

// 4. API Errors
logger.error('API error', {
  error: error.message,
  status: 500,
  route: req.path,
  method: req.method,
  stack: error.stack,
});

// 5. Stream Operations
logger.info('GPS stream started', {
  stream_id: stream.id,
  device_id: deviceId,
  route_id: routeId,
  speed: 30,
});

logger.info('GPS stream stopped', {
  stream_id: stream.id,
  device_id: deviceId,
  duration_seconds: 3600,
  total_points: 360,
});

// 6. GPX Processing
logger.info('GPX parsed successfully', {
  file_size: gpxContent.length,
  points_count: points.length,
  waypoints_count: waypoints.length,
});

logger.error('GPX parsing failed', {
  error: error.message,
  file_size: gpxContent.length,
  reason: validation.error,
});

// 7. Cache Operations
logger.info('Cache hit', {
  key_type: 'geocoding',
  query: 'Times Square, NYC',
  ttl_remaining_seconds: 3600,
});

logger.debug('Cache miss', {
  key_type: 'geocoding',
  query: 'Unknown Location',
});

// =========== ERROR LOGGING ===========

try {
  await someOperation();
} catch (error) {
  logger.error('Operation failed', {
    error: error.message,
    stack: error.stack,                  // Include stack trace
    context: 'additional_context',
  });
}

// =========== ASYNC OPERATIONS ===========

async function processRoute(routeId) {
  const startTime = Date.now();
  
  try {
    logger.debug('Processing route', { routeId });
    
    const route = await routeService.getRoute(routeId);
    const points = await routeService.getPoints(routeId);
    
    const duration = Date.now() - startTime;
    logger.info('Route processed successfully', {
      routeId,
      points_count: points.length,
      duration_ms: duration,
    });
    
    return route;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Route processing failed', {
      routeId,
      error: error.message,
      duration_ms: duration,
    });
    throw error;
  }
}

// =========== PERFORMANCE LOGGING ===========

function measurePerformance(name, callback) {
  const start = Date.now();
  
  try {
    const result = callback();
    const duration = Date.now() - start;
    
    if (duration > 1000) {
      logger.warn('Slow operation detected', { name, duration_ms: duration });
    } else {
      logger.debug('Operation completed', { name, duration_ms: duration });
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - start;
    logger.error('Operation failed', { name, error: error.message, duration_ms: duration });
    throw error;
  }
}

// =========== MIGRATION GUIDE ===========

/**
 * Quick replacement guide:
 * 
 * console.log(msg)         → logger.info(msg, {})
 * console.error(msg, err)  → logger.error(msg, { error: err.message })
 * console.warn(msg)        → logger.warn(msg, {})
 * console.debug(msg)       → logger.debug(msg, {})
 * 
 * Always include relevant context as second parameter!
 */

// =========== LOG OUTPUT EXAMPLES ===========

/**
 * Console (Development):
 * 2026-02-21 10:30:45 [info] gps-mock-backend: User logged in
 * 
 * JSON File (Production):
 * {
 *   "timestamp": "2026-02-21 10:30:45",
 *   "level": "info",
 *   "message": "User logged in",
 *   "userId": "abc123",
 *   "username": "admin",
 *   "ip": "192.168.1.1",
 *   "service": "gps-mock-backend"
 * }
 */

// =========== IMPORTING LOGGER ===========

// At the top of any file:
const logger = require('../lib/logger');

// Then use:
logger.info('Message', { context: 'data' });

module.exports = {
  // Example usage guide
};
