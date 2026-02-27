# Quick Start Guide - Production Improvements

## What's New? 🚀

Your GPS Mock Location Backend now has production-grade monitoring, validation, and logging!

---

## Installation (2 minutes)

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Start Development Server
```bash
npm run dev
```

### Step 3: Verify Setup
Open a new terminal and run:
```bash
curl http://localhost:4000/health
curl http://localhost:4000/metrics | head -20
```

---

## 1️⃣ Health Checks - Monitor Your Services

### What's Check?
- ✅ PostgreSQL database
- ✅ Redis cache
- ✅ Memory usage
- ✅ Server uptime

### Test It
```bash
# Check system health
curl http://localhost:4000/health | jq

# Response (healthy):
{
  "status": "ok",
  "database": { "status": "healthy" },
  "redis": { "status": "healthy" },
  "memory": { "heapUsed": "45MB", ... }
}

# Response (degraded):
{
  "status": "degraded",
  "database": { "status": "unhealthy", "error": "..." }
}
```

---

## 2️⃣ Prometheus Metrics - Real-time Visibility

### What's Tracked?
- WebSocket connections (active/total)
- Authentication attempts (success/fail)
- HTTP request durations
- Database query performance
- GPS data points processed
- Cache hit/miss rates
- Errors by type and severity

### Test It
```bash
# Get all metrics in Prometheus format
curl http://localhost:4000/metrics

# Search for specific metrics
curl http://localhost:4000/metrics | grep gps_websocket_connections_active

# Output: gps_websocket_connections_active{client_type="admin"} 2
```

### Integrate with Prometheus
Create `prometheus.yml`:
```yaml
scrape_configs:
  - job_name: 'gps-backend'
    static_configs:
      - targets: ['localhost:4000']
    metrics_path: '/metrics'
```

Run Prometheus:
```bash
./prometheus --config.file=prometheus.yml
```

Access dashboard: `http://localhost:9090`

---

## 3️⃣ Structured Logging - Better Debugging

### Files
- `logs/error.log` - Errors only
- `logs/combined.log` - All logs

### View Logs
```bash
# Real-time combined log
tail -f logs/combined.log

# Real-time error log
tail -f logs/error.log

# Last 50 lines
tail -50 logs/combined.log
```

### Example Log Output
```json
{
  "timestamp": "2026-02-21 10:30:45",
  "level": "info",
  "service": "gps-mock-backend",
  "message": "Device connected via WebSocket",
  "device_id": "android-001",
  "client_type": "device",
  "ip": "192.168.1.100"
}
```

---

## 4️⃣ Code Quality - ESLint & Prettier

### Check Code
```bash
npm run lint           # Find issues
npm run lint:fix       # Auto-fix issues
npm run format:check   # Check formatting
npm run format         # Auto-format code
```

### What's Enforced
- Consistent indentation (2 spaces)
- Single quotes for strings
- 100-character line width
- No unused variables
- Semicolons required

---

## 5️⃣ Input Validation - Prevent Bad Data

### Automatic Validation
All API endpoints now validate input with clear error messages:

```bash
# Example: Invalid login attempt
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "ab", "password": "123"}'

# Response:
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "path": "username",
      "message": "Username must be at least 3 characters"
    }
  ]
}
```

### Validated Endpoints
- `POST /api/auth/login` - Username & password
- `POST /api/devices/register` - Device info validation
- `POST /api/routes/from-points` - Coordinate validation
- `POST /api/routes/from-gpx` - GPX structure validation
- `POST /api/stream/start` - Stream parameters

---

## 6️⃣ Enhanced GPX Parser - Better Error Handling

### Strict Validation
- ✅ GPX structure validation
- ✅ Coordinate range checking (-90/90 lat, -180/180 lng)
- ✅ Track point extraction with error recovery
- ✅ Waypoint support
- ✅ Detailed error messages

### Test It
```bash
# Valid GPX route
curl -X POST http://localhost:4000/api/routes/from-gpx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "name": "My Route",
    "gpxContent": "<?xml version=\"1.0\"?>
      <gpx><trk><trkseg>
        <trkpt lat=\"40.7128\" lon=\"-74.0060\"/>
        <trkpt lat=\"40.7489\" lon=\"-73.9680\"/>
      </trkseg></trk></gpx>"
  }'
```

---

## 7️⃣ Smart ORS Caching - Faster Geocoding

### Automatic Caching
- Geocoding results: 24 hours
- Routes: 1 hour
- Reverse geocoding: 24 hours

### Cache Statistics
```bash
# Inside your app
const ors = require('./services/ors.service.enhanced');
const stats = await ors.getCacheStats();
console.log(stats);
// { total_keys: 542, geocode_keys: 300, route_keys: 242 }
```

### Monitor Cache Performance
```bash
# Via Prometheus metrics
curl http://localhost:4000/metrics | grep cache

# Output:
# gps_cache_hits_total{key_type="geocoding"} 892
# gps_cache_misses_total{key_type="geocoding"} 108
# Cache hit rate: 89%!
```

---

## 8️⃣ WebSocket Monitoring - Real-time Insights

### Tracked Events
- Connection attempts (success/failure)
- Message types (PING, STATUS, ACK)
- Disconnections with reasons
- Authentication failures

### Metrics Available
```bash
curl http://localhost:4000/metrics | grep websocket

# gps_websocket_connections_active{client_type="admin"} 2
# gps_websocket_connections_active{client_type="device"} 15
# gps_websocket_connections_total{client_type="device",status="success"} 47
# gps_messages_processed_total{type="PING",status="processed"} 523
```

---

## 🔍 Monitoring Dashboard (Optional)

### Docker Setup for Monitoring
```bash
# Create monitoring stack with Prometheus + Grafana
docker compose -f docker-compose.yml \
               -f docker-compose.monitoring.yml up -d
```

### Access Points
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000 (admin/admin)
- **API Metrics**: http://localhost:4000/metrics
- **Health**: http://localhost:4000/health

### Grafana Setup
1. Login: admin/admin
2. Add Prometheus datasource: http://prometheus:9090
3. Import dashboard or create queries
4. Example query: `gps_websocket_connections_active`

---

## 📊 Key Metrics to Monitor

| Metric | Sweet Spot | Warning | Critical |
|--------|-----------|---------|----------|
| WebSocket Connections | < 500 | 500-1000 | > 1000 |
| Database Query Duration (p95) | < 100ms | 100-500ms | > 500ms |
| HTTP Error Rate (5xx) | < 1% | 1-5% | > 5% |
| Cache Hit Rate | > 70% | 50-70% | < 50% |
| Auth Failure Rate | < 5% | 5-10% | > 10% |
| Memory Usage | < 60% | 60-80% | > 80% |

---

## 🚀 Production Checklist

Before deploying to production:

- [ ] Set `NODE_ENV=production` in `.env`
- [ ] Use strong `JWT_SECRET` (minimum 32 characters)
- [ ] Set strong `DEFAULT_ADMIN_PASSWORD`
- [ ] Configure external Prometheus/Grafana
- [ ] Set up alerting for critical metrics
- [ ] Test health checks and metrics endpoints
- [ ] Verify logs are being written
- [ ] Run `npm run lint` - fix any issues
- [ ] Clean up `.env` - remove development values
- [ ] Set up log rotation/archiving

---

## 🐛 Troubleshooting

### Logs not appearing?
```bash
# Check log level
echo $LOG_LEVEL
# Should output: debug (development) or info (production)

# If empty, set it
export LOG_LEVEL=debug
npm run dev
```

### Metrics endpoint returns 500?
```bash
# Verify prom-client is installed
npm list prom-client

# Reinstall if needed
npm install prom-client
```

### Cache not working?
```bash
# Check Redis connection
redis-cli ping
# Should return: PONG

# Check Redis URL
echo $REDIS_URL
```

### ESLint errors?
```bash
# Auto-fix most issues
npm run lint:fix

# Check again
npm run lint
```

---

## 📚 Documentation

- **Detailed Improvements**: See [IMPROVEMENTS.md](./IMPROVEMENTS.md)
- **API Documentation**: http://localhost:4000/api-docs
- **Prometheus Docs**: https://prometheus.io/docs
- **Winston Logger**: https://github.com/winstonjs/winston
- **Joi Validation**: https://joi.dev/api

---

## 🎉 You're All Set!

Your backend now has:
- ✅ Production-grade logging
- ✅ Real-time metrics & monitoring
- ✅ Input validation
- ✅ Enhanced error handling
- ✅ Code quality standards
- ✅ Smart caching
- ✅ Health checks

**Next**: Deploy and set up Prometheus/Grafana for full observability!

---

**Questions?** Check the detailed [IMPROVEMENTS.md](./IMPROVEMENTS.md) file or review the individual component docs.
