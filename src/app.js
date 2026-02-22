/**
 * Express Application
 * Main app configuration with routes and middleware
 */

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
const config = require('./config/config');
const { prisma } = require('./lib/prisma');
const { getRedis } = require('./lib/redis');

// Import routes
const authRoutes = require('./routes/auth.routes');
const deviceRoutes = require('./routes/device.routes');
const routeRoutes = require('./routes/route.routes');
const streamRoutes = require('./routes/stream.routes');
const geocodeRoutes = require('./routes/geocode.routes');

const app = express();
const isProd = config.NODE_ENV === 'production';

// ── CORS ─────────────────────────────────────────────────────────────────────
// In production: only allow configured origins.
// In development: allow all (pass no origin list).
app.use(cors({
    origin: isProd ? config.ALLOWED_ORIGINS : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' })); // Increased for GPX files
app.use(express.urlencoded({ extended: true }));

// ── Root endpoint ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.status(200).json({
        name: 'GPS Mock Location API',
        version: process.env.npm_package_version || '1.0.0',
        status: 'ok',
        docs: isProd ? 'disabled in production' : '/docs'
    });
});

// ── Swagger UI (development only) ────────────────────────────────────────────
if (!isProd) {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'GPS Mock Location API'
    }));
    // Keep legacy /api-docs path for convenience
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));
    console.log('📖 Swagger UI enabled at /docs (development mode)');
}

// ── Health check (real: checks DB + Redis) ───────────────────────────────────
app.get('/health', async (req, res) => {
    const result = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        db: 'unknown',
        redis: 'unknown'
    };
    let httpStatus = 200;

    // Check PostgreSQL
    try {
        await prisma.$queryRaw`SELECT 1`;
        result.db = 'ok';
    } catch (err) {
        result.db = 'error';
        result.status = 'degraded';
        httpStatus = 503;
        console.error('[Health] DB check failed:', err.message);
    }

    // Check Redis
    try {
        const redis = getRedis();
        const pong = await redis.ping();
        result.redis = pong === 'PONG' ? 'ok' : 'error';
        if (result.redis !== 'ok') {
            result.status = 'degraded';
            httpStatus = 503;
        }
    } catch (err) {
        result.redis = 'error';
        result.status = 'degraded';
        httpStatus = 503;
        console.error('[Health] Redis check failed:', err.message);
    }

    res.status(httpStatus).json(result);
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/stream', streamRoutes);
app.use('/api/geocode', geocodeRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

module.exports = app;