/**
 * WebSocket Server
 * Uses noServer: true + manual upgrade handling
 * Token and deviceId come from HEADERS
 * Validates against Redis + PostgreSQL
 */

const { WebSocketServer } = require('ws');
const { verifyToken } = require('../utils/jwt.util');
const deviceService = require('../services/device.service');
const auditService = require('../services/audit.service');

// Create WebSocket server with noServer: true
// This is CRITICAL - prevents Express from intercepting /ws
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket connections
wss.on('connection', async (ws, req) => {
    // Read token and deviceId from HEADERS
    const token = req.headers['authorization']?.replace('Bearer ', '');
    const deviceId = req.headers['x-device-id'];
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    console.log('🔐 WS CONNECT token:', token ? token.substring(0, 20) + '...' : 'missing');
    console.log('📱 WS CONNECT deviceId:', deviceId);
    console.log('🌐 WS CONNECT IP:', clientIp);

    // ═══════════════════════════════════════════════════════════════════
    // Validation 1: Check token exists
    // ═══════════════════════════════════════════════════════════════════
    if (!token) {
        console.log('❌ WebSocket rejected: No token provided');
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            deviceId,
            meta: { reason: 'no_token', ip: clientIp }
        });
        ws.close(4001, 'auth required');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Validation 2: Check deviceId exists
    // ═══════════════════════════════════════════════════════════════════
    if (!deviceId) {
        console.log('❌ WebSocket rejected: No deviceId provided');
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            meta: { reason: 'no_device_id', ip: clientIp }
        });
        ws.close(4003, 'deviceId required');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Validation 3: Verify JWT is valid
    // ═══════════════════════════════════════════════════════════════════
    let decodedToken;
    try {
        decodedToken = verifyToken(token);
    } catch (error) {
        console.log('❌ WebSocket rejected: Invalid token -', error.message);
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            deviceId,
            meta: { reason: 'invalid_token', error: error.message, ip: clientIp }
        });
        ws.close(4002, 'invalid token');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Validation 4: Check Redis authorization
    // ═══════════════════════════════════════════════════════════════════
    const isAuthorized = await deviceService.isDeviceAuthorizedForWS(deviceId, token);
    if (!isAuthorized) {
        console.log(`❌ WebSocket rejected: Device ${deviceId} not authorized in Redis`);
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            userId: decodedToken?.userId,
            deviceId,
            meta: { reason: 'not_authorized_redis', ip: clientIp }
        });
        ws.close(4004, 'device not registered');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Validation 5: Check device exists in PostgreSQL
    // ═══════════════════════════════════════════════════════════════════
    const deviceExists = await deviceService.deviceExists(deviceId);
    if (!deviceExists) {
        console.log(`❌ WebSocket rejected: Device ${deviceId} not found in database`);
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            userId: decodedToken?.userId,
            deviceId,
            meta: { reason: 'not_in_database', ip: clientIp }
        });
        ws.close(4004, 'device not registered');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // SUCCESS: Associate WebSocket connection with device
    // ═══════════════════════════════════════════════════════════════════
    try {
        await deviceService.setDeviceConnection(deviceId, ws);

        // Update device with last IP
        await deviceService.updateDevice(deviceId, { lastIp: clientIp });

        // Audit log
        await auditService.log(auditService.ACTIONS.WS_CONNECT, {
            userId: decodedToken?.userId,
            deviceId,
            meta: { ip: clientIp }
        });

        console.log(`✅ Device ${deviceId} connected via WebSocket`);
    } catch (error) {
        console.error(`❌ Failed to set device connection:`, error.message);
        ws.close(4500, 'internal error');
        return;
    }

    // Send welcome message
    ws.send(JSON.stringify({
        type: 'CONNECTED',
        payload: {
            deviceId,
            message: 'Connected to GPS Mock Location Server',
            timestamp: new Date().toISOString()
        }
    }));

    // ═══════════════════════════════════════════════════════════════════
    // Handle incoming messages from device
    // ═══════════════════════════════════════════════════════════════════
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log(`📥 Message from ${deviceId}:`, message.type);

            switch (message.type) {
                case 'PING':
                    // Refresh connection TTL in Redis
                    await deviceService.refreshDeviceConnection(deviceId);
                    ws.send(JSON.stringify({
                        type: 'PONG',
                        timestamp: new Date().toISOString()
                    }));
                    break;

                case 'STATUS':
                    await deviceService.updateDevice(deviceId, {
                        lastStatus: message.payload
                    });
                    break;

                case 'ACK':
                    // Device acknowledging received location
                    break;

                default:
                    console.log(`📨 Unknown message type: ${message.type}`);
            }
        } catch (error) {
            console.log(`⚠️ Invalid message from ${deviceId}:`, data.toString().substring(0, 100));
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    // Handle connection close
    // ═══════════════════════════════════════════════════════════════════
    ws.on('close', async (code, reason) => {
        console.log(`❌ Device ${deviceId} disconnected (code: ${code}, reason: ${reason?.toString() || 'none'})`);

        try {
            await deviceService.removeDeviceConnection(deviceId);
            await auditService.log(auditService.ACTIONS.WS_DISCONNECT, {
                userId: decodedToken?.userId,
                deviceId,
                meta: { code, reason: reason?.toString() }
            });
        } catch (error) {
            console.error(`⚠️ Error handling disconnect:`, error.message);
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    // Handle errors
    // ═══════════════════════════════════════════════════════════════════
    ws.on('error', async (error) => {
        console.error(`⚠️ WebSocket error for ${deviceId}:`, error.message);

        try {
            await deviceService.removeDeviceConnection(deviceId);
        } catch (err) {
            console.error(`⚠️ Error removing connection:`, err.message);
        }
    });
});

console.log('📡 WebSocket server initialized (noServer mode with Redis + PostgreSQL validation)');

module.exports = { wss };