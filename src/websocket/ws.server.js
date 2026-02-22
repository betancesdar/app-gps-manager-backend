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
    // Validation 3: Check authorization (Hybrid: Redis -> JWT -> Device Token)
    // ═══════════════════════════════════════════════════════════════════

    // 1. Check Redis Cache first (Fastest)
    let isAuthorized = await deviceService.isDeviceAuthorizedForWS(deviceId, token);
    let userId = null;
    let clientType = 'unknown';
    // FIX: declare decodedToken in outer scope so all subsequent code can reference it
    let decodedToken = null;

    if (!isAuthorized) {
        // Redis miss or expired. Validating credentials...

        // 2. Try Legacy JWT (User/Admin Token)
        try {
            const decoded = verifyToken(token);
            decodedToken = decoded; // ← assign to outer-scope variable
            if (decoded.role !== 'device') {
                userId = decoded.userId;
                isAuthorized = true;
                clientType = 'admin'; // Assume non-device tokens are admin/user
                console.log(`✅ WS Auth: User JWT for ${deviceId} (User: ${userId})`);
            } else {
                // 3. Try Device JWT (New Flow)
                // verifyToken already validated signature and expiration
                if (decoded.deviceId === deviceId) {
                    isAuthorized = true;
                    clientType = 'device';
                    console.log(`✅ WS Auth: Device JWT for ${deviceId}`);
                }
            }
        } catch (jwtError) {
            // Token invalid or expired
            console.log(`❌ WS Auth Failed: ${jwtError.message}`);
        }

        // If authorized, cache in Redis
        if (isAuthorized) {
            await deviceService.authorizeDeviceForWS(deviceId, userId || 'device', token);
        }
    } else {
        // Redis valid — restore userId and clientType from cache
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
            userId,  // FIX: use `userId` (always in scope) instead of decodedToken?.userId
            deviceId,
            meta: { reason: 'not_in_database', ip: clientIp }
        });
        ws.close(4004, 'device not registered');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // SUCCESS: Associate WebSocket connection with device
    // FIX: connection store errors are NON-FATAL — log but keep socket open
    // ═══════════════════════════════════════════════════════════════════
    try {
        await deviceService.setDeviceConnection(deviceId, ws);
        // Update device with last IP
        await deviceService.updateDevice(deviceId, { lastIp: clientIp });
        console.log(`✅ Device ${deviceId} connection stored`);
    } catch (connError) {
        // Non-fatal: log the warning but do NOT close the socket.
        // The device is authenticated and the WS is valid — let it stay connected.
        console.error(`⚠️ [WS] Failed to persist connection state for ${deviceId} (non-fatal):`, connError.message);
    }

    // Audit log (also non-fatal)
    try {
        await auditService.log(auditService.ACTIONS.WS_CONNECT, {
            userId,  // FIX: use `userId` (always in scope)
            deviceId,
            meta: { ip: clientIp }
        });
    } catch (auditErr) {
        console.warn(`⚠️ [WS] Audit log failed (non-fatal):`, auditErr.message);
    }

    // Broadcast to dashboards (non-fatal)
    try {
        broadcast('DEVICE_CONNECTED', { deviceId, ip: clientIp });
    } catch (broadcastErr) {
        console.warn(`⚠️ [WS] Broadcast failed (non-fatal):`, broadcastErr.message);
    }

    console.log(`✅ Device ${deviceId} connected via WebSocket (clientType: ${clientType})`);

    // Send CONNECTED frame to Android — always, regardless of internal errors above
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
                userId,  // FIX: use `userId` (always in scope)
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