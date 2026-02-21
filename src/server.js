/**
 * Server Entry Point
 * GPS Mock Location Backend
 * Port: 4000
 *
 * Production-Ready with PostgreSQL + Redis
 * CRITICAL: WebSocket uses noServer + manual upgrade handling
 */

require('dotenv').config();
const http = require('http');
const app = require('./app');
const { wss } = require('./websocket/ws.server');
const config = require('./config/config');
const { connectDatabase, disconnectDatabase } = require('./lib/prisma');
const { connectRedis, disconnectRedis } = require('./lib/redis');
const userService = require('./services/user.service');
const logger = require('./lib/logger');

// Create HTTP server
const server = http.createServer(app);

// CRITICAL: Manual WebSocket upgrade handler
// This prevents Express from intercepting /ws and returning 400
server.on('upgrade', (req, socket, head) => {
  const rawUrl = req.url;

  // Normalize URL: collapse double slashes (e.g. //ws -> /ws)
  req.url = req.url.replace(/\/+/g, '/');

  // Mask token in logs
  const authHeader = req.headers.authorization;
  const maskedAuth = authHeader
    ? `Bearer ${authHeader.replace('Bearer ', '').substring(0, 10)}***`
    : undefined;

  logger.debug('WS UPGRADE received', {
    raw_url: rawUrl,
    normalized_url: req.url,
    auth: maskedAuth ? '****' : 'missing',
  });

  // Only handle /ws path
  if (!req.url.startsWith('/ws')) {
    logger.warn('Non-WebSocket upgrade request rejected', { path: req.url });
    socket.destroy();
    return;
  }

  // Handle upgrade and emit connection
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

/**
 * Initialize databases and start server
 */
async function startServer() {
  try {
    logger.info('Starting GPS Mock Location Backend', {
      environment: config.NODE_ENV,
      port: config.PORT,
    });

    // Connect to PostgreSQL
    logger.info('Connecting to PostgreSQL...');
    await connectDatabase();

    // Ensure default admin user exists
    await userService.ensureDefaultUser();

    // Connect to Redis
    logger.info('Connecting to Redis...');
    await connectRedis();

    // Start HTTP server
    const PORT = config.PORT;
    server.listen(PORT, '0.0.0.0', () => {
      logger.info('✅ GPS Mock Location Backend Started', {
        http_server: `http://0.0.0.0:${PORT}`,
        websocket: `ws://0.0.0.0:${PORT}/ws`,
        health_check: `http://0.0.0.0:${PORT}/health`,
        metrics: `http://0.0.0.0:${PORT}/metrics`,
        api_docs: `http://0.0.0.0:${PORT}/api-docs`,
        default_user: 'admin / admin123',
      });

      logger.info('Available endpoints', {
        auth: 'POST /api/auth/login',
        devices: ['GET /api/devices', 'POST /api/devices/register'],
        routes: ['GET /api/routes', 'POST /api/routes/from-points'],
        stream: ['POST /api/stream/start', 'POST /api/stream/stop'],
      });
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown(signal) {
  logger.info(`Graceful shutdown initiated by signal: ${signal}`);

  // Close HTTP server (stops accepting new connections)
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      // Close all WebSocket connections
      wss.clients.forEach((client) => {
        client.close(1001, 'Server shutting down');
      });
      logger.info('WebSocket connections closed', {
        count: wss.clients.size,
      });

      // Disconnect from Redis
      await disconnectRedis();

      // Disconnect from PostgreSQL
      await disconnectDatabase();

      logger.info('✅ Graceful shutdown complete');
      process.exit(0);
    } catch (shutdownError) {
      logger.error('Error during shutdown', { error: shutdownError.message });
      process.exit(1);
    }
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Force shutdown after timeout');
    process.exit(1);
  }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason,
    promise: promise?.toString(),
  });
});

// Start the server
startServer();