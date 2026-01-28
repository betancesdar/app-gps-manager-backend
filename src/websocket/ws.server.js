/**
 * WebSocket Server
 * Handles real-time WebSocket connections with JWT authentication
 */

const WebSocket = require('ws');
const url = require('url');
const { verifyToken } = require('../utils/jwt.util');
const deviceService = require('../services/device.service');

/**
 * Initialize WebSocket server
 * @param {http.Server} server - HTTP server instance
 */
function initWebSocket(server) {
    const wss = new WebSocket.Server({
        server,
        path: '/ws'
    });

    wss.on('connection', (ws, req) => {
        // Parse query parameters for token and deviceId
        const queryParams = url.parse(req.url, true).query;
        const token = queryParams.token;
        const deviceId = queryParams.deviceId;

        // Validate JWT token
        if (!token) {
            console.log('❌ WebSocket connection rejected: No token provided');
            ws.close(4001, 'Authentication required');
            return;
        }

        let decoded;
        try {
            decoded = verifyToken(token);
        } catch (error) {
            console.log('❌ WebSocket connection rejected: Invalid token');
            ws.close(4002, 'Invalid token');
            return;
        }

        // Validate deviceId
        if (!deviceId) {
            console.log('❌ WebSocket connection rejected: No deviceId provided');
            ws.close(4003, 'deviceId required');
            return;
        }

        // Check if device is registered
        if (!deviceService.deviceExists(deviceId)) {
            console.log(`❌ WebSocket connection rejected: Device ${deviceId} not registered`);
            ws.close(4004, 'Device not registered');
            return;
        }

        // Associate WebSocket connection with device
        deviceService.setDeviceConnection(deviceId, ws);

        console.log(`🔗 Device ${deviceId} connected via WebSocket`);

        // Send welcome message
        ws.send(JSON.stringify({
            type: 'CONNECTED',
            payload: {
                deviceId,
                message: 'Connected to GPS Mock Location Server',
                user: decoded.username
            }
        }));

        // Handle incoming messages from device
        ws.on('message', (data) => {
            try {
                const message = JSON.parse(data.toString());
                console.log(`📥 Message from ${deviceId}:`, message);

                // Handle different message types from Android
                switch (message.type) {
                    case 'PING':
                        ws.send(JSON.stringify({
                            type: 'PONG',
                            timestamp: new Date().toISOString()
                        }));
                        break;

                    case 'STATUS':
                        // Device sending its status
                        deviceService.updateDevice(deviceId, {
                            lastStatus: message.payload
                        });
                        break;

                    case 'ACK':
                        // Device acknowledging received location
                        // Can be used for flow control if needed
                        break;

                    default:
                        console.log(`📨 Unknown message type: ${message.type}`);
                }
            } catch (error) {
                console.log(`⚠️ Invalid message from ${deviceId}:`, data.toString());
            }
        });

        // Handle connection close
        ws.on('close', (code, reason) => {
            console.log(`❌ Device ${deviceId} disconnected (code: ${code})`);
            deviceService.removeDeviceConnection(deviceId);
        });

        // Handle errors
        ws.on('error', (error) => {
            console.error(`⚠️ WebSocket error for ${deviceId}:`, error.message);
            deviceService.removeDeviceConnection(deviceId);
        });
    });

    // Log WebSocket server status
    console.log('📡 WebSocket server initialized on path /ws');

    return wss;
}

module.exports = initWebSocket;