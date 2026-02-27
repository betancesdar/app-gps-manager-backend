# 🚀 Docker Setup with New Features

## Overview
Your GPS Mock Location Backend now includes production-grade monitoring, logging, and validation features. This guide shows how to apply these changes to your Docker setup.

## 📋 What's New in Docker

### ✅ Updated Files
- `Dockerfile` - Includes new config files and logs directory
- `docker-compose.yml` - New environment variables and volume mappings
- `logs/` directory - For Winston logger output

### ✅ New Environment Variables
```bash
ORS_GEOCODING_CACHE_TTL=86400    # Cache TTL for geocoding
LOG_LEVEL=info                   # Winston log level
WS_AUTH_TTL=900                  # WebSocket auth TTL
WS_CONN_TTL=120                  # WebSocket connection TTL
RATE_LIMIT_ADDRESSES=20          # Rate limiting
RATE_LIMIT_WINDOW=60             # Rate limit window
```

### ✅ New Volume Mappings
```yaml
- ./.eslintrc.json:/app/.eslintrc.json
- ./.prettierrc:/app/.prettierrc
- ./.prettierignore:/app/.prettierignore
- ./logs:/app/logs
```

---

## 🛠️ Step-by-Step Setup

### Step 1: Stop Current Containers
```bash
# Stop existing containers
docker compose down

# Optional: Clean up old images
docker system prune -f
```

### Step 2: Rebuild and Start
```bash
# Rebuild with new dependencies and configurations
docker compose up --build -d

# View logs to ensure everything starts correctly
docker compose logs -f api
```

### Step 3: Verify Setup
```bash
# Check if containers are running
docker compose ps

# Test health endpoint
curl http://localhost:4000/health

# Test metrics endpoint
curl http://localhost:4000/metrics | head -10

# Check logs are being written
ls -la logs/
tail -f logs/combined.log
```

---

## 🔍 Troubleshooting

### Issue: "Module not found" errors
```bash
# Rebuild from scratch
docker compose down
docker rmi gps-api
docker compose up --build
```

### Issue: Logs directory not writable
```bash
# Check permissions
docker exec -it gps-api ls -la /app/logs

# Fix permissions if needed
docker exec -it gps-api chown -R 1001:1001 /app/logs
```

### Issue: Health check failing
```bash
# Check API logs
docker compose logs api

# Test health manually
docker exec -it gps-api curl http://localhost:4000/health
```

### Issue: Metrics not working
```bash
# Verify prom-client installation
docker exec -it gps-api npm list prom-client

# Reinstall if missing
docker exec -it gps-api npm install prom-client
```

---

## 📊 Monitoring in Docker

### Access Endpoints
- **Health Check**: http://localhost:4000/health
- **Prometheus Metrics**: http://localhost:4000/metrics
- **API Documentation**: http://localhost:4000/api-docs

### View Logs
```bash
# Real-time logs
docker compose logs -f api

# Logs from Winston
tail -f logs/combined.log
tail -f logs/error.log
```

### Check Resource Usage
```bash
# Container stats
docker stats

# Specific container
docker stats gps-api
```

---

## 🔧 Development vs Production

### Development (Local)
```bash
# Use local .env file
npm run dev

# Logs go to console + files
# Hot reload enabled
```

### Production (Docker)
```bash
# Use docker-compose environment variables
docker compose up -d

# Logs go to files only
# Optimized for production
```

### Environment Variables Priority
1. Docker environment variables (highest priority)
2. `.env` file (fallback)
3. Default values in `config.js` (lowest priority)

---

## 📈 Scaling with Docker

### Multiple Instances
```yaml
# In docker-compose.yml, add:
services:
  api:
    deploy:
      replicas: 3
    # ... rest of config
```

### Load Balancing
```yaml
# Add nginx reverse proxy
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - api
```

---

## 🔒 Security Considerations

### ✅ Implemented
- Non-root user in container
- Minimal Alpine Linux base
- No dev dependencies in production
- Environment variable secrets
- Health checks for auto-healing

### 🔐 Additional Recommendations
```bash
# Use secrets management
echo "your-secret-key" | docker secret create jwt_secret -

# Enable Docker secrets in compose
secrets:
  jwt_secret:
    external: true
```

---

## 📋 Maintenance Commands

### Update Dependencies
```bash
# Update package.json
npm update

# Rebuild containers
docker compose up --build -d
```

### Backup Logs
```bash
# Copy logs to backup
cp -r logs logs_backup_$(date +%Y%m%d)

# Clean old logs (keep last 7 days)
find logs -name "*.log" -mtime +7 -delete
```

### Monitor Disk Usage
```bash
# Check Docker disk usage
docker system df

# Clean up unused resources
docker system prune -a --volumes
```

---

## 🎯 Quick Verification Script

Create `verify-docker.sh`:
```bash
#!/bin/bash

echo "🔍 Verifying Docker Setup..."

# Check containers
echo "📦 Container Status:"
docker compose ps

# Test health
echo -e "\n🏥 Health Check:"
curl -s http://localhost:4000/health | jq .status

# Test metrics
echo -e "\n📊 Metrics Sample:"
curl -s http://localhost:4000/metrics | head -5

# Check logs
echo -e "\n📝 Log Files:"
ls -la logs/

echo -e "\n✅ Docker verification complete!"
```

Run with: `chmod +x verify-docker.sh && ./verify-docker.sh`

---

## 🚨 Common Issues & Solutions

| Issue | Symptom | Solution |
|-------|---------|----------|
| Port conflict | Port 4000 already in use | Change port in docker-compose.yml |
| Memory issues | Container crashes | Increase Docker memory limit |
| Database connection | Health check fails | Check postgres container logs |
| Redis connection | Caching not working | Verify redis container is running |
| Log permissions | Cannot write to logs/ | Fix permissions: `chown -R 1001 logs/` |

---

## 📚 Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Node.js Docker Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)
- [Prometheus Docker Guide](https://prometheus.io/docs/prometheus/latest/installation/#using-docker)
- [Winston Logging](https://github.com/winstonjs/winston)

---

## 🎉 Success Checklist

- [ ] `docker compose up --build` completes successfully
- [ ] `curl localhost:4000/health` returns `{"status":"ok"}`
- [ ] `curl localhost:4000/metrics` returns Prometheus format
- [ ] `ls logs/` shows log files being created
- [ ] API endpoints work as expected
- [ ] WebSocket connections are tracked in metrics

---

**Last Updated**: February 21, 2026
**Docker Support**: ✅ Fully Compatible
