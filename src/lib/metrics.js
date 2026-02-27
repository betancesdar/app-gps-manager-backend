/**
 * Prometheus Metrics
 * Tracks WebSocket connections, streams, errors and performance
 */

const prometheus = require('prom-client');

// Default metrics (CPU, memory, etc.)
prometheus.collectDefaultMetrics();

// Custom Metrics
const wsConnections = new prometheus.Gauge({
  name: 'gps_websocket_connections_active',
  help: 'Number of active WebSocket connections',
  labelNames: ['client_type'],
});

const wsConnectionsTotal = new prometheus.Counter({
  name: 'gps_websocket_connections_total',
  help: 'Total WebSocket connections established',
  labelNames: ['client_type', 'status'],
});

const streamsActive = new prometheus.Gauge({
  name: 'gps_streams_active',
  help: 'Number of active GPS streams',
  labelNames: ['status'],
});

const streamsTotal = new prometheus.Counter({
  name: 'gps_streams_total',
  help: 'Total GPS streams created',
  labelNames: ['status'],
});

const messagesProcessed = new prometheus.Counter({
  name: 'gps_messages_processed_total',
  help: 'Total WebSocket messages processed',
  labelNames: ['type', 'status'],
});

const authAttempts = new prometheus.Counter({
  name: 'gps_auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['result'],
});

const dbQueryDuration = new prometheus.Histogram({
  name: 'gps_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

const httpRequestDuration = new prometheus.Histogram({
  name: 'gps_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.1, 0.5, 1, 2, 5],
});

const errors = new prometheus.Counter({
  name: 'gps_errors_total',
  help: 'Total errors by type',
  labelNames: ['type', 'severity'],
});

const dataPoints = new prometheus.Counter({
  name: 'gps_data_points_processed_total',
  help: 'Total GPS data points processed',
  labelNames: ['source'],
});

const gpxParseErrors = new prometheus.Counter({
  name: 'gps_gpx_parse_errors_total',
  help: 'Total GPX parsing errors',
  labelNames: ['reason'],
});

const cacheHits = new prometheus.Counter({
  name: 'gps_cache_hits_total',
  help: 'Total cache hits',
  labelNames: ['key_type'],
});

const cacheMisses = new prometheus.Counter({
  name: 'gps_cache_misses_total',
  help: 'Total cache misses',
  labelNames: ['key_type'],
});

// Metrics registry
const register = prometheus.register;

module.exports = {
  wsConnections,
  wsConnectionsTotal,
  streamsActive,
  streamsTotal,
  messagesProcessed,
  authAttempts,
  dbQueryDuration,
  httpRequestDuration,
  errors,
  dataPoints,
  gpxParseErrors,
  cacheHits,
  cacheMisses,
  register,
};
