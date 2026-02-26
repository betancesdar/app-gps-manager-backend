/**
 * Stream Service
 * Manages coordinate streaming PER DEVICE
 * PostgreSQL for history, Redis for hot state
 * Map<deviceId, StreamInstance> for active intervals
 *
 * Dwell support: when a route point has dwellSeconds > 0,
 * the stream pauses at that point (emitting speed=0, state=WAIT)
 * for the specified duration before continuing.
 */

const { prisma } = require('../lib/prisma');
const { setStreamState, updateStreamState, deleteStreamState, getStreamState } = require('../lib/redis');
const { calculateBearing, calculateDistance, interpolatePoint } = require('../utils/geospatial.util');
const deviceService = require('./device.service');
const routeService = require('./route.service');
const config = require('../config/config');

// Active streams per device (intervals, not serializable)
// Map<deviceId, StreamInstance>
const activeStreams = new Map();

const ENGINE_CONSTANTS = {
    aMax: 1.5, // m/s² (acceleration)
    bMax: 2.5, // m/s² (deceleration)
    lookAheadMeters: 15, // for angular smoothing target
    MAX_METERS_PER_TICK: 50, // Physical clamp
    MAX_JUMP_METERS: 100 // Anti-teleport
};

/**
 * StreamInstance class
 * Tracks streaming state for a single device
 */
class StreamInstance {
    constructor(deviceId, routeId, points, streamConfig) {
        this.deviceId = deviceId;
        this.routeId = routeId;
        this.points = points;
        this.config = { ...streamConfig };
        this.currentIndex = 0; // Legacy
        this.status = 'idle';
        this.intervalId = null;
        this.startedAt = null;
        this.lastEmitAt = null;
        this.dbId = null;

        // Dwell state
        this.dwellTicksRemaining = 0;
        this.state = 'MOVE';

        // Distance engine physics state
        this.sMeters = 0;
        this.vMps = 0;
        this.vTargetMps = (this.config.speed || 30) / 3.6;
        this.segIndex = 0;
        this.segProgress = 0;
        this.headingDeg = 0;
        this.lastTickTs = Date.now();
        this.lastEmittedLatLng = null;
        this.engineMode = config.STREAM_DISTANCE_ENGINE ? 'distance' : 'index';

        // Backpressure state
        this.sentTicks = 0;
        this.skippedTicks = 0;
        this.pressureStrikes = 0;
        this.pressureWindowStartMs = Date.now();
        this.lastHealthLogTs = Date.now();
    }
}

/**
 * Get socket buffer sizes (WS queue and underlying TCP buffer)
 */
function getSocketPressure(ws) {
    const wsBuffered = ws?.bufferedAmount ?? 0;
    const tcpBuffered = ws?._socket?.bufferSize ?? 0;
    return { wsBuffered, tcpBuffered };
}

/**
 * Evaluate if thresholds are crossed
 */
function isPressured(ws) {
    const { wsBuffered, tcpBuffered } = getSocketPressure(ws);
    return wsBuffered > config.STREAM_WS_BUFFERED_MAX_BYTES || tcpBuffered > config.STREAM_WS_TCP_MAX_BYTES;
}

/**
 * Start streaming coordinates to a device
 */
async function startStream(deviceId, routeId, options = {}) {
    const ws = deviceService.getDeviceConnection(deviceId);
    if (!ws) {
        throw new Error('Device not connected via WebSocket');
    }

    const route = await routeService.getRoute(routeId);
    if (!route) {
        throw new Error('Route not found');
    }

    if (activeStreams.has(deviceId)) {
        await stopStream(deviceId);
    }

    const streamConfig = {
        speed: parseFloat(options.speed || route.config?.speed || config.STREAM_DEFAULTS.speed),
        accuracy: parseFloat(options.accuracy || route.config?.accuracy || config.STREAM_DEFAULTS.accuracy),
        intervalMs: parseInt(options.intervalMs || route.config?.intervalMs || config.STREAM_DEFAULTS.intervalMs),
        loop: options.loop !== undefined ? options.loop : (route.config?.loop || config.STREAM_DEFAULTS.loop)
    };

    const stream = new StreamInstance(deviceId, routeId, route.points, streamConfig);
    stream.status = 'running';
    stream.startedAt = new Date().toISOString();

    const dbStream = await prisma.stream.create({
        data: {
            deviceId,
            routeId,
            status: 'STARTED',
            speed: streamConfig.speed,
            loop: streamConfig.loop
        }
    });
    stream.dbId = dbStream.id;

    await setStreamState(deviceId, {
        streamId: dbStream.id,
        routeId,
        status: 'running',
        currentIndex: 0,
        totalPoints: route.points.length,
        speed: streamConfig.speed,
        loop: streamConfig.loop
    });

    console.log(`[Stream] STREAM_STARTED 🚀 device=${deviceId} engineMode=${stream.engineMode}`);
    console.log(JSON.stringify({
        event: 'STREAM_STARTED',
        deviceId,
        speedConfigured: streamConfig.speed,
        speedApplied: stream.vTargetMps * 3.6,
        engineMode: stream.engineMode
    }));

    // Start emitting coordinates
    stream.intervalId = setInterval(() => {
        emitNextCoordinate(deviceId);
    }, streamConfig.intervalMs);

    // Emit first coordinate immediately
    emitNextCoordinate(deviceId);

    activeStreams.set(deviceId, stream);

    return {
        streamId: dbStream.id,
        deviceId,
        routeId,
        status: stream.status,
        totalPoints: stream.points.length,
        config: stream.config
    };
}

/**
 * Emit the next coordinate
 */
async function emitNextCoordinate(deviceId) {
    try {
        const stream = activeStreams.get(deviceId);
        if (!stream || (stream.status !== 'running' && stream.status !== 'paused')) return;

        const ws = deviceService.getDeviceConnection(deviceId);
        if (!ws || ws.readyState !== 1) {
            if (stream.status !== 'paused') {
                await pauseStream(deviceId).catch(e => console.error('Error auto-pausing closed ws:', e));
            } else {
                console.log(`[Stream] WS not ready for ${deviceId} while paused. Skipping tick.`);
            }
            return;
        }

        // --- BACKPRESSURE GUARD & CIRCUIT BREAKER ---
        if (config.STREAM_WS_BACKPRESSURE_ENABLED) {
            const now = Date.now();
            const { wsBuffered, tcpBuffered } = getSocketPressure(ws);

            if (isPressured(ws)) {
                stream.skippedTicks++;
                stream.pressureStrikes++;

                if (now - stream.pressureWindowStartMs > config.STREAM_WS_PRESSURE_WINDOW_MS) {
                    stream.pressureStrikes = 1;
                    stream.pressureWindowStartMs = now;
                }

                console.log(JSON.stringify({
                    event: "ws_pressure_skip",
                    deviceId,
                    wsBuffered,
                    tcpBuffered,
                    thresholds: {
                        wsMax: config.STREAM_WS_BUFFERED_MAX_BYTES,
                        tcpMax: config.STREAM_WS_TCP_MAX_BYTES
                    },
                    strikes: stream.pressureStrikes,
                    status: stream.status,
                    state: stream.state,
                    engineMode: stream.engineMode
                }));

                if (stream.pressureStrikes >= config.STREAM_WS_PRESSURE_STRIKES_TO_PAUSE) {
                    console.log(JSON.stringify({
                        event: "ws_pressure_auto_pause",
                        deviceId,
                        strikes: stream.pressureStrikes,
                        windowMs: config.STREAM_WS_PRESSURE_WINDOW_MS,
                        wsBuffered,
                        tcpBuffered
                    }));
                    await pauseStream(deviceId).catch(e => console.error('Error auto-pausing on pressure:', e));
                }

                if (now - stream.lastHealthLogTs >= 10000) {
                    stream.lastHealthLogTs = now;
                    console.log(JSON.stringify({
                        event: "stream_ws_health",
                        deviceId,
                        sentTicks: stream.sentTicks,
                        skippedTicks: stream.skippedTicks,
                        wsBuffered,
                        tcpBuffered,
                        status: stream.status,
                        state: stream.state
                    }));
                }

                stream.lastTickTs = now;
                return;
            } else {
                if (now - stream.pressureWindowStartMs > config.STREAM_WS_PRESSURE_WINDOW_MS) {
                    stream.pressureStrikes = 0;
                    stream.pressureWindowStartMs = now;
                }

                if (now - stream.lastHealthLogTs >= 10000) {
                    stream.lastHealthLogTs = now;
                    console.log(JSON.stringify({
                        event: "stream_ws_health",
                        deviceId,
                        sentTicks: stream.sentTicks,
                        skippedTicks: stream.skippedTicks,
                        wsBuffered,
                        tcpBuffered,
                        status: stream.status,
                        state: stream.state
                    }));
                }
            }
        }
        // --- END BACKPRESSURE GUARD ---

        const isPaused = stream.status === 'paused';

        if (stream.engineMode === 'distance') {
            const now = Date.now();
            const dtMs = Math.min(
                config.STREAM_TICK_CLAMP_MAX_MS,
                Math.max(config.STREAM_TICK_CLAMP_MIN_MS, now - stream.lastTickTs)
            );
            const dt = dtMs / 1000;
            stream.lastTickTs = now;

            const currentPoint = stream.points[stream.segIndex];

            let isWaiting = stream.state === 'WAIT';

            if (!isPaused && currentPoint.dwellSeconds > 0) {
                if (stream.dwellTicksRemaining === 0 && stream.state === 'MOVE') {
                    stream.vTargetMps = 0;
                    stream.state = 'WAIT';
                    isWaiting = true;
                    const ticks = Math.ceil((currentPoint.dwellSeconds * 1000) / stream.config.intervalMs);
                    stream.dwellTicksRemaining = ticks;
                    console.log(`[Stream] enter WAIT device=${deviceId} ticks=${ticks}`);
                }
            }

            if (isWaiting) {
                if (stream.vMps <= 0.1) {
                    stream.vMps = 0;
                    if (!isPaused) {
                        stream.dwellTicksRemaining--;
                    }

                    // Throttle keepalive logs
                    if (!stream.keepaliveTick) stream.keepaliveTick = 0;
                    if (stream.keepaliveTick++ % 10 === 0) {
                        console.log(`[Stream] Keepalive WAIT device=${deviceId} dwellRemaining=${stream.dwellTicksRemaining}`);
                    }

                    if (!isPaused && stream.dwellTicksRemaining <= 0) {
                        stream.dwellTicksRemaining = 0;
                        stream.state = 'MOVE';
                        // restore target velocity
                        stream.vTargetMps = stream.config.speed / 3.6;
                        console.log(`[Stream] exit WAIT device=${deviceId}`);
                        isWaiting = false;
                    }
                }
            }

            if (isPaused) {
                stream.vMps = 0;
                // Throttle keepalive logs
                if (!stream.keepaliveTick) stream.keepaliveTick = 0;
                if (stream.keepaliveTick++ % 10 === 0) {
                    console.log(`[Stream] Keepalive PAUSED device=${deviceId}`);
                }
            }

            // Velocity Physics
            if (stream.vMps < stream.vTargetMps) {
                stream.vMps += ENGINE_CONSTANTS.aMax * dt;
                if (stream.vMps > stream.vTargetMps) stream.vMps = stream.vTargetMps;
            } else if (stream.vMps > stream.vTargetMps) {
                stream.vMps -= ENGINE_CONSTANTS.bMax * dt;
                if (stream.vMps < stream.vTargetMps) stream.vMps = stream.vTargetMps;
            }
            if (stream.vMps < 0) stream.vMps = 0;

            // Dynamic clamp
            const maxMetersPerTick = Math.min(80, Math.max(15, stream.vTargetMps * dt * 2.5));
            let metersToAdvance = stream.vMps * dt;
            metersToAdvance = Math.min(metersToAdvance, maxMetersPerTick);

            // Segment Traversal
            stream.sMeters += metersToAdvance;
            stream.segProgress += metersToAdvance;

            while (stream.segIndex < stream.points.length - 1) {
                const p1 = stream.points[stream.segIndex];
                const p2 = stream.points[stream.segIndex + 1];
                const segDist = calculateDistance(p1, p2);

                if (stream.segProgress >= segDist && segDist > 0) {
                    stream.segIndex++;
                    stream.segProgress -= segDist;
                } else {
                    break;
                }
            }

            const p1 = stream.points[stream.segIndex];
            const p2 = stream.points[stream.segIndex + 1] || p1;
            const segDist = calculateDistance(p1, p2);

            let lat, lng;
            const isKeepalive = stream.vMps === 0 && (isPaused || isWaiting);

            if (isKeepalive) {
                const keepalivePoint = stream.lastEmittedLatLng || p1;
                lat = keepalivePoint.lat;
                lng = keepalivePoint.lng;
            } else {
                const fraction = segDist > 0 ? stream.segProgress / segDist : 0;
                const interpolated = interpolatePoint(p1, p2, Math.min(1, fraction));
                lat = interpolated.lat;
                lng = interpolated.lng;
            }

            // Bearing & LookAhead Smoothing
            let futureDist = stream.segProgress + ENGINE_CONSTANTS.lookAheadMeters;
            let futureIndex = stream.segIndex;
            while (futureIndex < stream.points.length - 1) {
                const fd = calculateDistance(stream.points[futureIndex], stream.points[futureIndex + 1]);
                if (futureDist > fd) {
                    futureDist -= fd;
                    futureIndex++;
                } else {
                    break;
                }
            }
            const futurePoint = stream.points[futureIndex + 1] || stream.points[futureIndex] || p2;
            const rawTargetBearing = calculateBearing({ lat, lng }, futurePoint);

            if (!isKeepalive) {
                if (stream.vMps > 0.5) {
                    let diff = rawTargetBearing - stream.headingDeg;
                    diff = ((diff + 540) % 360) - 180;
                    stream.headingDeg = (stream.headingDeg + diff * 0.3 + 360) % 360;
                } else if (stream.segIndex === 0 && stream.segProgress === 0) {
                    stream.headingDeg = rawTargetBearing;
                }
            }

            // Anti-Teleport
            if (stream.lastEmittedLatLng && !isKeepalive) {
                const jumpDist = calculateDistance(stream.lastEmittedLatLng, { lat, lng });
                if (jumpDist > ENGINE_CONSTANTS.MAX_JUMP_METERS) {
                    console.error(`[Stream] Anti-teleport triggered for ${deviceId}: Jump of ${Math.round(jumpDist)}m`);
                    pauseStream(deviceId);

                    console.error(JSON.stringify({
                        error: "ANTI_TELEPORT_JUMP",
                        deviceId,
                        jumpMeters: jumpDist,
                        dtMs,
                        vMps: stream.vMps,
                        segIndex: stream.segIndex
                    }));
                    return;
                }
            }

            stream.lastEmittedLatLng = { lat, lng };

            let effectiveState = stream.state;
            if (isPaused) effectiveState = 'PAUSED';

            const message = {
                type: 'MOCK_LOCATION',
                payload: {
                    lat,
                    lng,
                    speed: stream.vMps, // Always in m/s (0 if stopped)
                    bearing: stream.headingDeg,
                    accuracy: stream.config.accuracy,
                    state: effectiveState
                },
                meta: {
                    engineMode: 'distance',
                    dtMs,
                    sMeters: Math.round(stream.sMeters),
                    vMps: parseFloat(stream.vMps.toFixed(2)),
                    segIndex: stream.segIndex,
                    pointIndex: stream.segIndex,
                    totalPoints: stream.points.length,
                    routeId: stream.routeId,
                    timestamp: new Date().toISOString()
                }
            };

            if (effectiveState === 'WAIT') {
                const totalDwellMs = stream.dwellTicksRemaining * stream.config.intervalMs;
                message.meta.dwellRemainingSeconds = Math.round(totalDwellMs / 1000);
            }

            try {
                ws.send(JSON.stringify(message));
                stream.sentTicks++;
                stream.lastEmitAt = new Date().toISOString();

                await updateStreamState(deviceId, {
                    currentIndex: stream.segIndex
                });
            } catch (error) {
                console.log(JSON.stringify({ event: "ws_send_error", deviceId, msg: error.message }));
                return;
            }

            if (stream.segIndex >= stream.points.length - 1 && stream.segProgress >= segDist - 0.5) {
                if (stream.config.loop) {
                    stream.sMeters = 0;
                    stream.segIndex = 0;
                    stream.segProgress = 0;
                    stream.state = 'MOVE';
                    stream.lastEmittedLatLng = null;
                } else {
                    await stopStream(deviceId).catch(e => console.error('Error auto-stopping:', e));
                }
            }
        } else {
            // --- OLD INDEX-BASED ENGINE ---
            const currentPoint = stream.points[stream.currentIndex];

            if (!isPaused && stream.dwellTicksRemaining === 0 && currentPoint.dwellSeconds > 0 && stream.state === 'MOVE') {
                const ticks = Math.ceil((currentPoint.dwellSeconds * 1000) / stream.config.intervalMs);
                stream.dwellTicksRemaining = ticks;
                stream.state = 'WAIT';
                console.log(`[Stream] enter WAIT device=${deviceId} ticks=${ticks}`);
            }

            const isWaiting = stream.state === 'WAIT' && stream.dwellTicksRemaining > 0;
            const effectiveSpeed = (isWaiting || isPaused) ? 0 : stream.config.speed;

            let lat, lng;
            if (isWaiting || isPaused) {
                const keepalivePoint = stream.lastEmittedLatLng || currentPoint;
                lat = keepalivePoint.lat;
                lng = keepalivePoint.lng;

                if (!stream.keepaliveTick) stream.keepaliveTick = 0;
                if (stream.keepaliveTick++ % 10 === 0) {
                    console.log(`[Stream] Keepalive ${isPaused ? 'PAUSED' : 'WAIT'} device=${deviceId}`);
                }
            } else {
                lat = currentPoint.lat;
                lng = currentPoint.lng;
            }

            stream.lastEmittedLatLng = { lat, lng };

            const nextPoint = stream.points[stream.currentIndex + 1] || stream.points[0];
            const bearing = calculateBearing(currentPoint, nextPoint);

            let effectiveState = stream.state;
            if (isPaused) effectiveState = 'PAUSED';

            const message = {
                type: 'MOCK_LOCATION',
                payload: {
                    lat,
                    lng,
                    speed: effectiveSpeed / 3.6, // Always in m/s
                    bearing: bearing,
                    accuracy: stream.config.accuracy,
                    state: effectiveState
                },
                meta: {
                    engineMode: 'index',
                    dtMs: stream.config.intervalMs,
                    pointIndex: stream.currentIndex,
                    totalPoints: stream.points.length,
                    routeId: stream.routeId,
                    timestamp: new Date().toISOString()
                }
            };

            if (effectiveState === 'WAIT') {
                const totalDwellMs = stream.dwellTicksRemaining * stream.config.intervalMs;
                message.meta.dwellRemainingSeconds = Math.round(totalDwellMs / 1000);
            }

            try {
                ws.send(JSON.stringify(message));
                stream.sentTicks++;
                stream.lastEmitAt = new Date().toISOString();

                await updateStreamState(deviceId, {
                    currentIndex: stream.currentIndex
                });
            } catch (error) {
                console.log(JSON.stringify({ event: "ws_send_error", deviceId, msg: error.message }));
                return;
            }

            if (isWaiting || isPaused) {
                if (isWaiting && !isPaused) {
                    stream.dwellTicksRemaining--;
                    if (stream.dwellTicksRemaining <= 0) {
                        stream.dwellTicksRemaining = 0;
                        stream.state = 'MOVE';
                        console.log(`[Stream] exit WAIT device=${deviceId}`);
                    }
                }
                return; // Keepalive sent, do not advance index
            }

            stream.currentIndex++;

            if (stream.currentIndex >= stream.points.length) {
                if (stream.config.loop) {
                    stream.currentIndex = 0;
                    stream.state = 'MOVE';
                    stream.dwellTicksRemaining = 0;
                } else {
                    await stopStream(deviceId).catch(e => console.error('Error auto-stopping index:', e));
                }
            }
        }
    } catch (criticalError) {
        console.error(`[CRITICAL] Error inside emitNextCoordinate for device ${deviceId}:`, criticalError);
        // Clean interval immediately to prevent infinitely repeating crash loop
        const stream = activeStreams.get(deviceId);
        if (stream && stream.intervalId) {
            clearInterval(stream.intervalId);
            stream.intervalId = null;
            stream.status = 'paused';
        }
    }
}

async function pauseStream(deviceId) {
    try {
        const stream = activeStreams.get(deviceId);
        if (!stream) {
            return {
                deviceId,
                status: 'not_running',
                currentIndex: 0,
                totalPoints: 0
            };
        }

        if (stream.status === 'paused') {
            return {
                deviceId,
                status: 'paused',
                currentIndex: stream.engineMode === 'distance' ? stream.segIndex : stream.currentIndex,
                totalPoints: stream.points.length
            };
        }

        // DO NOT clearInterval to allow keepalives
        // if (stream.intervalId) {
        //     clearInterval(stream.intervalId);
        //     stream.intervalId = null;
        // }

        stream.status = 'paused';
        stream.state = 'PAUSED';

        if (stream.dbId) {
            try {
                await prisma.stream.update({
                    where: { id: stream.dbId },
                    data: { status: 'PAUSED' }
                });
            } catch (err) {
                console.error(`[Stream] DB error on pause for ${deviceId}`, err.message);
            }
        }

        try {
            await updateStreamState(deviceId, { status: 'paused' });
        } catch (err) {
            console.error(`[Stream] Redis error on pause for ${deviceId}`, err.message);
        }

        return {
            deviceId,
            status: stream.status,
            currentIndex: stream.engineMode === 'distance' ? stream.segIndex : stream.currentIndex,
            totalPoints: stream.points.length
        };
    } catch (criticalError) {
        console.error(`[Stream] Critical error pausing stream for ${deviceId}:`, criticalError.stack);
        return { deviceId, status: 'error', error: 'Failed to pause' };
    }
}

async function resumeStream(deviceId) {
    try {
        const stream = activeStreams.get(deviceId);
        if (!stream) return null;

        if (stream.status === 'running') {
            return {
                deviceId,
                status: 'running',
                currentIndex: stream.engineMode === 'distance' ? stream.segIndex : stream.currentIndex,
                totalPoints: stream.points.length
            };
        }

        stream.status = 'running';

        if (stream.dbId) {
            try {
                await prisma.stream.update({
                    where: { id: stream.dbId },
                    data: { status: 'STARTED' }
                });
            } catch (err) {
                console.error(`[Stream] DB error on resume for ${deviceId}`, err.message);
            }
        }

        try {
            await updateStreamState(deviceId, { status: 'running' });
        } catch (err) {
            console.error(`[Stream] Redis error on resume for ${deviceId}`, err.message);
        }

        // Reset lastTickTs when resuming distance engine
        if (stream.engineMode === 'distance') {
            stream.lastTickTs = Date.now();
        }

        if (stream.intervalId) {
            clearInterval(stream.intervalId);
        }

        stream.intervalId = setInterval(() => {
            emitNextCoordinate(deviceId);
        }, stream.config.intervalMs);

        emitNextCoordinate(deviceId);

        return {
            deviceId,
            status: stream.status,
            currentIndex: stream.engineMode === 'distance' ? stream.segIndex : stream.currentIndex,
            totalPoints: stream.points.length
        };
    } catch (criticalError) {
        console.error(`[Stream] Critical error resuming stream for ${deviceId}:`, criticalError.stack);
        return null;
    }
}

async function stopStream(deviceId) {
    try {
        const stream = activeStreams.get(deviceId);

        if (!stream) {
            return {
                deviceId,
                status: 'stopped',
                finalIndex: 0,
                totalPoints: 0,
                noop: true
            };
        }

        const statusBefore = stream.status;
        const finalIndex = stream.engineMode === 'distance' ? stream.segIndex : stream.currentIndex;
        const totalPoints = stream.points ? stream.points.length : 0;
        const dbId = stream.dbId;

        await cleanupStream(deviceId, `User requested stop`);

        if (dbId) {
            try {
                await prisma.stream.update({
                    where: { id: dbId },
                    data: {
                        status: 'STOPPED',
                        stoppedAt: new Date()
                    }
                });
            } catch (err) {
                console.error(`[Stream] DB error on stop for ${deviceId}`, err.message);
            }
        }

        const data = {
            deviceId,
            status: 'stopped',
            finalIndex,
            totalPoints
        };

        // Output structured log as requested
        console.log(JSON.stringify({
            event: 'STREAM_STOP',
            deviceId,
            statusBefore,
            statusAfter: 'stopped',
            reason: 'manual_stop'
        }));

        return data;
    } catch (criticalError) {
        console.error(`[Stream] Critical error stopping stream for ${deviceId}:`, criticalError.stack);
        // Best effort cleanup even on complete failure
        await cleanupStream(deviceId, 'crash_recovery');
        return { deviceId, status: 'stopped', error: 'Stopped with errors' };
    }
}

/**
 * Cleanup helper to safely clear memory timers and Redis streams
 */
async function cleanupStream(deviceId, reason) {
    console.log(`[Stream] Cleanup triggered for device=${deviceId}, reason="${reason}"`);

    const stream = activeStreams.get(deviceId);
    if (stream && stream.intervalId) {
        clearInterval(stream.intervalId);
        stream.intervalId = null;
    }

    activeStreams.delete(deviceId);

    try {
        await deleteStreamState(deviceId);
    } catch (err) {
        console.error(`[Stream] Failed to delete redis state for device=${deviceId}:`, err.message);
    }
}

async function getStreamStatus(deviceId) {
    const stream = activeStreams.get(deviceId);
    if (stream) {
        return {
            deviceId,
            routeId: stream.routeId,
            status: stream.status,
            state: stream.state,
            currentIndex: stream.engineMode === 'distance' ? stream.segIndex : stream.currentIndex,
            totalPoints: stream.points.length,
            dwellTicksRemaining: stream.dwellTicksRemaining,
            config: stream.config,
            startedAt: stream.startedAt,
            lastEmitAt: stream.lastEmitAt
        };
    }

    const redisState = await getStreamState(deviceId);
    if (redisState) {
        return {
            deviceId,
            routeId: redisState.routeId,
            status: redisState.status,
            currentIndex: redisState.currentIndex,
            totalPoints: redisState.totalPoints,
            fromRedis: true
        };
    }

    return null;
}

function getAllStreams() {
    const streams = [];
    activeStreams.forEach((stream, deviceId) => {
        streams.push({
            deviceId,
            routeId: stream.routeId,
            status: stream.status,
            state: stream.state,
            currentIndex: stream.engineMode === 'distance' ? stream.segIndex : stream.currentIndex,
            totalPoints: stream.points.length
        });
    });
    return streams;
}

function hasActiveStream(deviceId) {
    return activeStreams.has(deviceId);
}

async function getStreamHistory(deviceId, limit = 10) {
    return prisma.stream.findMany({
        where: { deviceId },
        orderBy: { startedAt: 'desc' },
        take: limit,
        include: {
            route: {
                select: { name: true }
            }
        }
    });
}

module.exports = {
    startStream,
    pauseStream,
    resumeStream,
    stopStream,
    getStreamStatus,
    getAllStreams,
    hasActiveStream,
    getStreamHistory
};
