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

// Create HTTP server
const server = http.createServer(app);

// CRITICAL: Manual WebSocket upgrade handler
// This prevents Express from intercepting /ws and returning 400
server.on('upgrade', (req, socket, head) => {
    const rawUrl = req.url;

    // Normalize URL: collapse double slashes (e.g. //ws -> /ws)
    req.url = req.url.replace(/\/+/g, '/');

    // Mask token in logs
    const authHeader = req.headers['authorization'];
    const maskedAuth = authHeader
        ? 'Bearer ' + authHeader.replace('Bearer ', '').substring(0, 10) + '***'
        : undefined;

    console.log('🔥 WS UPGRADE raw url:', rawUrl);
    console.log('🔥 WS UPGRADE normalized url:', req.url);
    console.log('🔥 WS UPGRADE headers:', JSON.stringify({
        authorization: maskedAuth,
        'x-device-id': req.headers['x-device-id']
    }));

    // Only handle /ws path
    if (!req.url.startsWith('/ws')) {
        console.log('❌ Not a WebSocket path, destroying socket');
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
        console.log('═══════════════════════════════════════════');
        console.log('   🚀 Starting GPS Mock Location Backend');
        console.log('═══════════════════════════════════════════');
        console.log(`   Environment: ${config.NODE_ENV}`);

        // Connect to PostgreSQL
        console.log('\n📦 Connecting to PostgreSQL...');
        await connectDatabase();

        // Ensure default admin user exists
        await userService.ensureDefaultUser();

        // Connect to Redis
        console.log('\n🔴 Connecting to Redis...');
        await connectRedis();

        // Start HTTP server
        const PORT = config.PORT;
        server.listen(PORT, '0.0.0.0', () => {
            console.log('\n═══════════════════════════════════════════');
            console.log('   ✅ GPS Mock Location Backend Started');
            console.log('═══════════════════════════════════════════');
            console.log(`   📡 HTTP Server:  http://0.0.0.0:${PORT}`);
            console.log(`   🔌 WebSocket:    ws://0.0.0.0:${PORT}/ws`);
            console.log('═══════════════════════════════════════════');
            console.log('   📋 Endpoints:');
            console.log(`      POST /api/auth/login`);
            console.log(`      POST /api/devices/register`);
            console.log(`      GET  /api/devices`);
            console.log(`      POST /api/routes/from-points`);
            console.log(`      POST /api/routes/from-gpx`);
            console.log(`      POST /api/stream/start`);
            console.log(`      POST /api/stream/pause`);
            console.log(`      POST /api/stream/resume`);
            console.log(`      POST /api/stream/stop`);
            console.log('═══════════════════════════════════════════');
            console.log('\n   💡 Admin credentials: admin / admin123');
            console.log('═══════════════════════════════════════════\n');
        });

    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

/**
 * Graceful shutdown
 */
async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Starting graceful shutdown...`);

    // Close HTTP server (stops accepting new connections)
    server.close(async () => {
        console.log('🛑 HTTP server closed');

        try {
            // Close all WebSocket connections
            wss.clients.forEach((client) => {
                client.close(1001, 'Server shutting down');
            });
            console.log('🔌 WebSocket connections closed');

            // Disconnect from Redis
            await disconnectRedis();

            // Disconnect from PostgreSQL
            await disconnectDatabase();

            console.log('✅ Graceful shutdown complete');
            process.exit(0);
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
            process.exit(1);
        }
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
        console.error('⚠️ Forcing shutdown after timeout');
        process.exit(1);
    }, 10000);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer();