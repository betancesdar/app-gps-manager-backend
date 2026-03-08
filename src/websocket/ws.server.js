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
    // Serialize once to prevent event loop blocking on massive broadcasts
    const messageStr = JSON.stringify({
        type,
        payload,
        timestamp: new Date().toISOString()
    });

    wss.clients.forEach(client => {
        // Filter: Device and Stream events go only to admins (dashboards).
        // Exceptions: MOCK_LOCATION goes to the specific device.
        if ((type.startsWith('DEVICE_') || type.startsWith('STREAM_')) && client.clientType !== 'admin') {
            return;
        }

        if (client.readyState === 1) { // OPEN
            client.send(messageStr);
        }
    });
}

// ── Heartbeat Loop (Server -> Client) ─────────────────────────────────────────
const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.missedPings >= 4) {
            console.log(`[WS] 💀 Terminating dead connection (No PONG received in 80s)`);
            return ws.terminate();
        }
        ws.missedPings = (ws.missedPings || 0) + 1;
        try {
            ws.ping();
        } catch (error) {
            console.log(`[WS] 💀 Terminating ping-failed connection.`);
            return ws.terminate();
        }
    });
}, 20000);

wss.on('close', () => {
    clearInterval(heartbeatInterval);
});

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
    const ua = req.headers['user-agent'] || 'unknown';

    // Mask token in logs (show first 20 chars only)
    const tokenPreview = token ? token.substring(0, 20) + '...' : 'missing';
    console.log(`🔐 WS CONNECT token: ${tokenPreview}`);
    console.log(`📱 WS CONNECT deviceId: ${deviceId || 'missing'}`);
    console.log(`🌐 WS CONNECT IP: ${clientIp}`);

    // Heartbeat setup for this client
    ws.isAlive = true;
    ws.missedPings = 0;
    ws.on('pong', () => {
        ws.isAlive = true;
        ws.missedPings = 0;
    });

    // ═══════════════════════════════════════════════════════════════════
    // Validation 1: Check token exists
    // ═══════════════════════════════════════════════════════════════════
    if (!token) {
        console.log('❌ WebSocket rejected: No token provided');
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            meta: { reason: 'no_token', ip: clientIp, ua, attemptedDeviceId: deviceId }
        }).catch(() => { });
        ws.close(4001, 'auth required');
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Validation 1.5: Decode token to check if Admin/User (bypass deviceId)
    // ═══════════════════════════════════════════════════════════════════
    let isGlobalAdminOrUser = false;
    let decodedToken = null;
    let isInvalidSignature = false;
    let jwtErrorMsg = null;
    try {
        decodedToken = verifyToken(token);
        if (decodedToken && decodedToken.role !== 'device') {
            isGlobalAdminOrUser = true;
        }
    } catch (e) {
        jwtErrorMsg = e.message;
        if (e.message === 'invalid signature') isInvalidSignature = true;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Validation 2: Check deviceId exists (if not admin)
    // ═══════════════════════════════════════════════════════════════════
    if (!deviceId && !isGlobalAdminOrUser) {
        console.log('❌ WebSocket rejected: No deviceId provided for device connection');
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            meta: { reason: 'no_device_id', ip: clientIp, ua }
        }).catch(() => { });
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
        const failReason = isInvalidSignature ? 'invalid signature' : (jwtErrorMsg || 'auth_failed');
        await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
            meta: { reason: failReason, ip: clientIp, ua, attemptedDeviceId: deviceId }
        }).catch(() => { });

        if (isInvalidSignature) {
            ws.close(4001, 'Sesión Inválida');
        } else if (jwtErrorMsg === 'jwt expired') {
            ws.close(4001, 'Token expired');
        } else {
            ws.close(4001, 'Not authorized');
        }
        return;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Validation 5: Check device exists in PostgreSQL
    // ═══════════════════════════════════════════════════════════════════
    if (clientType !== 'admin') {
        const deviceExists = await deviceService.deviceExists(deviceId);
        if (!deviceExists) {
            console.log(`❌ WebSocket rejected: Device ${deviceId} not found in database`);
            await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
                meta: { reason: 'not_in_database', ip: clientIp, ua, attemptedDeviceId: deviceId }
            }).catch(() => { });
            ws.close(4004, 'device not registered');
            return;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // SUCCESS: Associate WebSocket connection with device
    // FIX: connection store errors are NON-FATAL — log but keep socket open
    // ═══════════════════════════════════════════════════════════════════
    try {
        if (clientType !== 'admin') {
            await deviceService.setDeviceConnection(deviceId, ws);
            // Update device with last IP
            await deviceService.updateDevice(deviceId, { lastIp: clientIp });
            console.log(`✅ Device ${deviceId} connection stored`);
        } else {
            console.log(`✅ Admin Dashboard connected via WebSocket (User: ${userId})`);
        }
    } catch (connError) {
        // Non-fatal: log the warning but do NOT close the socket.
        // The device is authenticated and the WS is valid — let it stay connected.
        console.error(`⚠️ [WS] Failed to persist connection state for ${deviceId} (non-fatal):`, connError.message);
    }

    // Audit log (also non-fatal)
    try {
        if (clientType !== 'admin' || !deviceId) {
            await auditService.log(auditService.ACTIONS.WS_CONNECT, {
                userId,  // FIX: use `userId` (always in scope)
                deviceId: clientType !== 'admin' ? deviceId : undefined,
                meta: { ip: clientIp }
            });
        }
    } catch (auditErr) {
        console.warn(`⚠️ [WS] Audit log failed (non-fatal):`, auditErr.message);
    }

    // Broadcast to dashboards (non-fatal)
    try {
        if (clientType !== 'admin') {
            broadcast('DEVICE_CONNECTED', { deviceId, ip: clientIp });
            console.log(`✅ Device ${deviceId} connected via WebSocket (clientType: ${clientType})`);
        }
    } catch (broadcastErr) {
        console.warn(`⚠️ [WS] Broadcast failed (non-fatal):`, broadcastErr.message);
    }

    // Send CONNECTED frame to Android — always, regardless of internal errors above
    ws.send(JSON.stringify({
        type: 'CONNECTED',
        payload: {
            deviceId: deviceId || 'admin',
            message: 'Connected to GPS Mock Location Server',
            timestamp: new Date().toISOString()
        }
    }));

    // ═══════════════════════════════════════════════════════════════════
    // Handle incoming messages from device
    // ═══════════════════════════════════════════════════════════════════
    ws.on('message', async (data) => {
        // Any message from the client (including JSON PINGs) means it's alive.
        // This prevents the 25s heartbeat monitor from falsely terminating Android clients.
        ws.isAlive = true;

        try {
            const message = JSON.parse(data.toString());
            // Only log if not a spammy PING to keep terminal clean
            if (message.type !== 'PING') {
                console.log(`📥 Message from ${deviceId || 'admin'}:`, message.type);
            }

            switch (message.type) {
                case 'PING':
                    // Refresh connection TTL in Redis
                    if (clientType !== 'admin') {
                        await deviceService.refreshDeviceConnection(deviceId);
                    }
                    ws.send(JSON.stringify({
                        type: 'PONG',
                        timestamp: new Date().toISOString()
                    }));
                    break;

                case 'STATUS':
                    if (clientType !== 'admin') {
                        await deviceService.updateDevice(deviceId, {
                            lastStatus: message.payload
                        });
                    }
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
        const reasonStr = reason ? reason.toString() : 'none';
        if (clientType === 'admin') {
            console.log(`❌ [WS CLOSE] Admin Dashboard disconnected | Code: ${code} | Reason: ${reasonStr}`);
            return;
        }

        console.log(`❌ [WS CLOSE] Device ${deviceId} disconnected | Code: ${code} | Reason: ${reasonStr}`);

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
        if (clientType === 'admin') {
            console.error(`⚠️ [WS ERROR] Admin error: ${error.message} | Stack: ${error.stack}`);
            return;
        }

        console.error(`⚠️ [WS ERROR] Device ${deviceId} error: ${error.message} | Stack: ${error.stack}`);

        try {
            await deviceService.removeDeviceConnection(deviceId);
        } catch (err) {
            console.error(`⚠️ Error removing connection:`, err.message);
        }
    });
});

console.log('📡 WebSocket server initialized (noServer mode with Redis + PostgreSQL validation)');

module.exports = { wss, broadcast };