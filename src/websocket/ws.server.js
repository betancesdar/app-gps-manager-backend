/**
 * WebSocket Server
 * Uses noServer: true + manual upgrade handling
 * Auth: headers (Android) OR query params (tooling/curl)
 *   - Authorization: Bearer <token>  OR  ?token=<token>
 *   - X-Device-Id: <id>              OR  ?deviceId=<id>
 * Validates against Redis + PostgreSQL
 */

const { WebSocketServer } = require('ws');
const { verifyToken } = require('../utils/jwt.util');
const deviceService = require('../services/device.service');
const auditService = require('../services/audit.service');

// Create WebSocket server with noServer: true
// This is CRITICAL - prevents Express from intercepting /ws
const wss = new WebSocketServer({ noServer: true });

/**
 * Broadcast message to all connected clients (dashboards)
 * @param {string} type 
 * @param {Object} payload 
 */
function broadcast(type, payload) {
    wss.clients.forEach(client => {
        // Filter: Device events go only to admins (dashboards)
        // Devices don't need to know about other devices connecting
        if (type.startsWith('DEVICE_') && client.clientType !== 'admin') {
            return;
        }

        if (client.readyState === 1) { // OPEN
            client.send(JSON.stringify({
                type,
                payload,
                timestamp: new Date().toISOString()
            }));
        }
    });
}

// Handle WebSocket connections
wss.on('connection', async (ws, req) => {
    // ── Parse query params (for tooling fallback) ─────────────────────
    const urlStr = req.url || '';
    const qIdx = urlStr.indexOf('?');
    const queryParams = qIdx >= 0
        ? new URLSearchParams(urlStr.slice(qIdx + 1))
        : new URLSearchParams();

    // Auth: prefer headers (Android), fall back to query params (tooling)
    const rawAuthHeader = req.headers['authorization'];
    const token = rawAuthHeader?.replace('Bearer ', '').trim()
        || queryParams.get('token')
        || null;

    const deviceId = req.headers['x-device-id']
        || queryParams.get('deviceId')
        || null;

    const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;

    // Mask token in logs (show first 20 chars only)
    const tokenPreview = token ? token.substring(0, 20) + '...' : 'missing';
    console.log(`🔐 WS CONNECT token: ${tokenPreview}`);
    console.log(`📱 WS CONNECT deviceId: ${deviceId || 'missing'}`);
    console.log(`🌐 WS CONNECT IP: ${clientIp}`);

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
    // Validation 1.5: Decode token to check if Admin/User (bypass deviceId)
    // ═══════════════════════════════════════════════════════════════════
    let isGlobalAdminOrUser = false;
    let decodedToken = null;
    let jwtErrorMsg = null;
    try {
        decodedToken = verifyToken(token);
        if (decodedToken && decodedToken.role !== 'device') {
            isGlobalAdminOrUser = true;
        }
    } catch (e) {
        jwtErrorMsg = e.message;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Validation 2: Check deviceId exists (if not admin)
    // ═══════════════════════════════════════════════════════════════════
    if (!deviceId && !isGlobalAdminOrUser) {
        console.log('❌ WebSocket rejected: No deviceId provided for device connection');
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            meta: { reason: 'no_device_id', ip: clientIp }
        });
        ws.close(4003, 'deviceId required');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Validation 3: Check authorization (Hybrid: Redis -> JWT -> Device Token)
    // ═══════════════════════════════════════════════════════════════════

    // 1. Check Redis Cache first (Fastest) - ONLY if deviceId is present
    let isAuthorized = false;
    if (deviceId) {
        isAuthorized = await deviceService.isDeviceAuthorizedForWS(deviceId, token);
    }

    let userId = null;
    let clientType = 'unknown';

    if (!isAuthorized) {
        // Redis miss or expired (or no deviceId). Validating credentials...
        if (jwtErrorMsg) {
            console.log(`❌ WS Auth Failed: ${jwtErrorMsg}`);
        } else if (isGlobalAdminOrUser) {
            userId = decodedToken.userId;
            isAuthorized = true;
            clientType = 'admin';
            console.log(`✅ WS Auth: User JWT for Global Connection (User: ${userId})`);
        } else if (decodedToken && decodedToken.deviceId === deviceId) {
            isAuthorized = true;
            clientType = 'device';
            console.log(`✅ WS Auth: Device JWT for ${deviceId}`);
        }

        // If authorized AND we have a deviceId, cache in Redis
        if (isAuthorized && deviceId) {
            await deviceService.authorizeDeviceForWS(deviceId, userId || 'device', token);
        }
    } else {
        // Redis valid
        const cachedAuth = await deviceService.getWsAuthorization(deviceId);
        userId = cachedAuth?.userId;
        // Infer client type from userId (if it's 'device', then device)
        clientType = (userId === 'device') ? 'device' : 'admin';
    }

    // Attach client type to WS instance for broadcasting
    ws.clientType = clientType;

    if (!isAuthorized) {
        console.log(`❌ WebSocket rejected: Not authorized`);
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            deviceId,
            meta: { reason: 'auth_failed', ip: clientIp }
        });
        ws.close(4001, 'auth failed');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Validation 5: Check device exists in PostgreSQL
    // ═══════════════════════════════════════════════════════════════════
    const deviceExists = await deviceService.deviceExists(deviceId);
    if (!deviceExists) {
        console.log(`❌ WebSocket rejected: Device ${deviceId} not found in database`);
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            userId: userId,
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
            userId: userId,
            deviceId,
            meta: { ip: clientIp }
        });

        console.log(`✅ Device ${deviceId} connected via WebSocket`);

        // Broadcast to dashboards
        broadcast('DEVICE_CONNECTED', { deviceId, ip: clientIp });
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
                userId: userId,
                deviceId,
                meta: { code, reason: reason?.toString() }
            });

            // Broadcast to dashboards
            broadcast('DEVICE_DISCONNECTED', {
                deviceId,
                code,
                reason: reason?.toString()
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

module.exports = { wss, broadcast };