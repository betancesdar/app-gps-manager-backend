/**
 * Express Application
 * Main app configuration with routes and middleware
 */

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
const logger = require('./lib/logger');
const metrics = require('./lib/metrics');
const { prisma } = require('./lib/prisma');
const { redis } = require('./lib/redis');

// Import routes
const authRoutes = require('./routes/auth.routes');
const deviceRoutes = require('./routes/device.routes');
const routeRoutes = require('./routes/route.routes');
const streamRoutes = require('./routes/stream.routes');
const geocodeRoutes = require('./routes/geocode.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased for GPX files
app.use(express.urlencoded({ extended: true }));

// HTTP Request metrics middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    metrics.httpRequestDuration
      .labels(req.method, req.route?.path || req.path, res.statusCode)
      .observe(duration);
  });
  next();
});

// Swagger UI - Available at http://localhost:4000
app.use('/', swaggerUi.serve);
app.get('/', swaggerUi.setup(swaggerSpecs, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'GPS Mock Location API',
}));

// Also available at /api-docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));

// Enhanced health check endpoint with detailed metrics
app.get('/health', async (req, res) => {
  try {
    const healthData = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    };

    // Check database connectivity
    try {
      await prisma.$queryRaw`SELECT 1`;
      healthData.database = { status: 'healthy' };
    } catch (dbError) {
      healthData.database = {
        status: 'unhealthy',
        error: dbError.message,
      };
      healthData.status = 'degraded';
    }

    // Check Redis connectivity
    try {
      const pong = await redis.ping();
      healthData.redis = {
        status: pong === 'PONG' ? 'healthy' : 'unhealthy',
      };
    } catch (redisError) {
      healthData.redis = {
        status: 'unhealthy',
        error: redisError.message,
      };
      healthData.status = 'degraded';
    }

    // Memory usage
    const memUsage = process.memoryUsage();
    healthData.memory = {
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
    };

    // Active connections metrics
    healthData.metrics = {
      uptime_seconds: process.uptime(),
    };

    const statusCode = healthData.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(healthData);
  } catch (error) {
    logger.error('Health check error', { error: error.message });
    res.status(500).json({
      status: 'unhealthy',
      error: 'Internal server error',
    });
  }
});

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', metrics.register.contentType);
    const metricsText = await metrics.register.metrics();
    res.end(metricsText);
  } catch (error) {
    logger.error('Metrics endpoint error', { error: error.message });
    res.status(500).end('Failed to generate metrics');
  }
});

// API Routes
// Compatibility for Android App (Legacy Enrollment Endpoint)
const deviceController = require('./controllers/device.controller');
app.post('/api/enrollment/claim', deviceController.activate);

app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/geocode', geocodeRoutes);

// 404 handler
app.use((req, res) => {
  metrics.errors.inc({ type: '404', severity: 'low' });
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Server error', { error: err.message, stack: err.stack });
  metrics.errors.inc({ type: 'server_error', severity: 'high' });

  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

module.exports = app;