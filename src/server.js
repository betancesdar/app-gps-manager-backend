/**
 * Server Entry Point
 * GPS Mock Location Backend
 * Port: 4000
 */

require('dotenv').config();
const http = require('http');
const app = require('./app');
const initWebSocket = require('./websocket/ws.server');
const config = require('./config/config');

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
initWebSocket(server);

// Start server
const PORT = config.PORT;
server.listen(PORT, () => {
    console.log('═══════════════════════════════════════════');
    console.log('   🚀 GPS Mock Location Backend Started');
    console.log('═══════════════════════════════════════════');
    console.log(`   📡 HTTP Server:  http://localhost:${PORT}`);
    console.log(`   🔌 WebSocket:    ws://localhost:${PORT}/ws`);
    console.log('═══════════════════════════════════════════');
    console.log('   📋 Endpoints:');
    console.log(`      POST /api/auth/login`);
    console.log(`      POST /api/devices/register`);
    console.log(`      POST /api/routes/from-points`);
    console.log(`      POST /api/routes/from-gpx`);
    console.log(`      POST /api/stream/start`);
    console.log(`      POST /api/stream/pause`);
    console.log(`      POST /api/stream/resume`);
    console.log(`      POST /api/stream/stop`);
    console.log('═══════════════════════════════════════════');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    server.close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
});