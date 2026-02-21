/**
 * WebSocket Server
 * Uses noServer: true + manual upgrade handling
 * Auth: headers (Android) OR query params (tooling/curl)
 *   - Authorization: Bearer <token>  OR  ?token=<token>
 *   - X-Device-Id: <id>              OR  ?deviceId=<id>
 * Validates against Redis + PostgreSQL
 * Integrated with Prometheus metrics and Winston logger
 */

const { WebSocketServer } = require('ws');
const { verifyToken } = require('../utils/jwt.util');
const deviceService = require('../services/device.service');
const auditService = require('../services/audit.service');
const logger = require('../lib/logger');
const metrics = require('../lib/metrics');

// Create WebSocket server with noServer: true
// This is CRITICAL - prevents Express from intercepting /ws
const wss = new WebSocketServer({ noServer: true });

/**
 * Broadcast message to all connected clients (dashboards)
 * @param {string} type
 * @param {Object} payload
 */
function broadcast(type, payload) {
  let messagesSent = 0;
  wss.clients.forEach((client) => {
    // Filter: Device events go only to admins (dashboards)
    // Devices don't need to know about other devices connecting
    if (type.startsWith('DEVICE_') && client.clientType !== 'admin') {
      return;
    }

    if (client.readyState === 1) {
      // OPEN
      try {
        client.send(
          JSON.stringify({
            type,
            payload,
            timestamp: new Date().toISOString(),
          })
        );
        messagesSent += 1;
      } catch (error) {
        logger.warn('Failed to send broadcast message', {
          type,
          client_id: client.clientId,
          error: error.message,
        });
      }
    }
  });

  if (messagesSent > 0) {
    metrics.messagesProcessed.labels(type, 'sent').inc(messagesSent);
  }
}

/**
 * Update WebSocket connection metrics
 */
function updateMetrics() {
  const adminCount = Array.from(wss.clients).filter(
    (c) => c.clientType === 'admin'
  ).length;
  const deviceCount = Array.from(wss.clients).filter(
    (c) => c.clientType === 'device'
  ).length;

  metrics.wsConnections.labels('admin').set(adminCount);
  metrics.wsConnections.labels('device').set(deviceCount);
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
  const rawAuthHeader = req.headers.authorization;
  const token = rawAuthHeader?.replace('Bearer ', '').trim()
    || queryParams.get('token')
    || null;

  const deviceId = req.headers['x-device-id'] || queryParams.get('deviceId') || null;

  const clientIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress;

  // Generate unique client ID for tracking
  const clientId = `${deviceId}_${Date.now()}`;
  ws.clientId = clientId;

  // Mask token in logs (show first 20 chars only)
  const tokenPreview = token ? `${token.substring(0, 20)}...` : 'missing';
  logger.info('WebSocket connection attempt', {
    client_id: clientId,
    device_id: deviceId || 'missing',
    token: tokenPreview,
    ip: clientIp,
  });

  // ═══════════════════════════════════════════════════════════════════
  // Validation 1: Check token exists
  // ═══════════════════════════════════════════════════════════════════
  if (!token) {
    logger.warn('WebSocket rejected: No token provided', { device_id: deviceId });
    metrics.authAttempts.labels('failed').inc();
    await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
      deviceId,
      meta: { reason: 'no_token', ip: clientIp },
    });
    ws.close(4001, 'auth required');
    return;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Validation 2: Check deviceId exists
  // ═══════════════════════════════════════════════════════════════════
  if (!deviceId) {
    logger.warn('WebSocket rejected: No deviceId provided');
    metrics.authAttempts.labels('failed').inc();
    await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
      meta: { reason: 'no_device_id', ip: clientIp },
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
  let decodedToken = null;

  if (!isAuthorized) {
    // Redis miss or expired. Validating credentials...

    // 2. Try Legacy JWT (User/Admin Token)
    try {
      decodedToken = verifyToken(token);
      if (decodedToken.role !== 'device') {
        userId = decodedToken.userId;
        isAuthorized = true;
        clientType = 'admin'; // Assume non-device tokens are admin/user
        logger.info('WebSocket auth: User JWT', {
          device_id: deviceId,
          user_id: userId,
        });
      } else {
        // 3. Try Device JWT (New Flow)
        // verifyToken already validated signature and expiration
        if (decodedToken.deviceId === deviceId) {
          isAuthorized = true;
          clientType = 'device';
          logger.info('WebSocket auth: Device JWT', { device_id: deviceId });
        }
      }
    } catch (jwtError) {
      // Token invalid or expired
      logger.debug('JWT verification failed', {
        device_id: deviceId,
        error: jwtError.message,
      });
    }

    // If authorized, cache in Redis
    if (isAuthorized) {
      await deviceService.authorizeDeviceForWS(deviceId, userId || 'device', token);
    }
  } else {
    // Redis valid
    const cachedAuth = await deviceService.getWsAuthorization(deviceId);
    userId = cachedAuth?.userId;
    // Infer client type from userId (if it's 'device', then device)
    clientType = userId === 'device' ? 'device' : 'admin';
  }

  // Attach client type to WS instance for broadcasting
  ws.clientType = clientType;

  if (!isAuthorized) {
    logger.warn('WebSocket rejected: Not authorized', {
      device_id: deviceId,
      client_type: clientType,
    });
    metrics.authAttempts.labels('failed').inc();
    await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
      deviceId,
      meta: { reason: 'auth_failed', ip: clientIp },
    });
    ws.close(4001, 'auth failed');
    return;
  }

  // Increment successful auth counter
  metrics.authAttempts.labels('success').inc();

  // ═══════════════════════════════════════════════════════════════════
  // Validation 5: Check device exists in PostgreSQL
  // ═══════════════════════════════════════════════════════════════════
  const deviceExists = await deviceService.deviceExists(deviceId);
  if (!deviceExists) {
    logger.warn('WebSocket rejected: Device not found in database', {
      device_id: deviceId,
    });
    metrics.authAttempts.labels('failed').inc();
    await auditService.log(auditService.ACTIONS.WS_AUTH_FAIL, {
      userId: decodedToken?.userId,
      deviceId,
      meta: { reason: 'not_in_database', ip: clientIp },
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
      meta: { ip: clientIp, client_type: clientType },
    });

    logger.info('Device connected via WebSocket', {
      device_id: deviceId,
      client_type: clientType,
      ip: clientIp,
    });

    // Update metrics
    metrics.wsConnectionsTotal.labels(clientType, 'success').inc();
    updateMetrics();

    // Broadcast to dashboards
    broadcast('DEVICE_CONNECTED', { deviceId, ip: clientIp, clientType });
  } catch (error) {
    logger.error('Failed to set device connection', {
      device_id: deviceId,
      error: error.message,
    });
    metrics.errors.inc({ type: 'ws_connection_setup', severity: 'high' });
    ws.close(4500, 'internal error');
    return;
  }

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: 'CONNECTED',
      payload: {
        deviceId,
        message: 'Connected to GPS Mock Location Server',
        timestamp: new Date().toISOString(),
      },
    })
  );

  // ═══════════════════════════════════════════════════════════════════
  // Handle incoming messages from device
  // ═══════════════════════════════════════════════════════════════════
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      logger.debug('WebSocket message received', {
        device_id: deviceId,
        message_type: message.type,
      });

      switch (message.type) {
        case 'PING':
          // Refresh connection TTL in Redis
          await deviceService.refreshDeviceConnection(deviceId);
          ws.send(
            JSON.stringify({
              type: 'PONG',
              timestamp: new Date().toISOString(),
            })
          );
          metrics.messagesProcessed.labels('PING', 'processed').inc();
          break;

        case 'STATUS':
          await deviceService.updateDevice(deviceId, {
            lastStatus: message.payload,
          });
          metrics.messagesProcessed.labels('STATUS', 'processed').inc();
          break;

        case 'ACK':
          // Device acknowledging received location
          metrics.messagesProcessed.labels('ACK', 'processed').inc();
          break;

        default:
          logger.debug('Unknown WebSocket message type', {
            device_id: deviceId,
            message_type: message.type,
          });
          metrics.messagesProcessed.labels('UNKNOWN', 'processed').inc();
      }
    } catch (error) {
      logger.warn('Invalid WebSocket message', {
        device_id: deviceId,
        error: error.message,
        data: data.toString().substring(0, 100),
      });
      metrics.messagesProcessed.labels('INVALID', 'error').inc();
      metrics.errors.inc({ type: 'ws_message_parse', severity: 'medium' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Handle connection close
  // ═══════════════════════════════════════════════════════════════════
  ws.on('close', async (code, reason) => {
    logger.info('WebSocket disconnected', {
      device_id: deviceId,
      close_code: code,
      reason: reason?.toString(),
    });

    try {
      await deviceService.removeDeviceConnection(deviceId);
      await auditService.log(auditService.ACTIONS.WS_DISCONNECT, {
        userId: decodedToken?.userId,
        deviceId,
        meta: { code, reason: reason?.toString() },
      });

      // Update metrics
      metrics.wsConnectionsTotal.labels(clientType, 'disconnected').inc();
      updateMetrics();

      // Broadcast to dashboards
      broadcast('DEVICE_DISCONNECTED', {
        deviceId,
        code,
        reason: reason?.toString(),
      });
    } catch (error) {
      logger.error('Error handling disconnect', {
        device_id: deviceId,
        error: error.message,
      });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Handle errors
  // ═══════════════════════════════════════════════════════════════════
  ws.on('error', async (error) => {
    logger.error('WebSocket error', {
      device_id: deviceId,
      error: error.message,
    });

    metrics.errors.inc({ type: 'ws_error', severity: 'high' });

    try {
      await deviceService.removeDeviceConnection(deviceId);
    } catch (err) {
      logger.error('Error removing connection after WS error', {
        device_id: deviceId,
        error: err.message,
      });
    }
  });
});

logger.info('WebSocket server initialized (noServer mode with Redis + PostgreSQL validation + Prometheus metrics)');

module.exports = { wss, broadcast, updateMetrics };
