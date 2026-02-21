#!/bin/bash

# 🚀 Docker Verification Script for GPS Mock Location Backend
# Run this after applying Docker changes to verify everything works

echo "🔍 Verifying GPS Mock Location Backend Docker Setup..."
echo "======================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
    fi
}

# Check if Docker is running
echo "📦 Checking Docker status..."
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running${NC}"
    exit 1
fi
print_status 0 "Docker is running"

# Check if containers are up
echo -e "\n🏗️  Checking container status..."
if ! docker compose ps | grep -q "Up"; then
    echo -e "${RED}❌ No containers are running${NC}"
    echo "Run: docker compose up --build -d"
    exit 1
fi
print_status 0 "Containers are running"

# Show container status
echo "Container Status:"
docker compose ps

# Wait for services to be ready
echo -e "\n⏳ Waiting for services to be ready..."
sleep 5

# Test health endpoint
echo -e "\n🏥 Testing health endpoint..."
if curl -s http://localhost:4000/health > /dev/null 2>&1; then
    HEALTH_STATUS=$(curl -s http://localhost:4000/health | jq -r .status 2>/dev/null || echo "unknown")
    if [ "$HEALTH_STATUS" = "ok" ]; then
        print_status 0 "Health check passed"
    else
        print_status 1 "Health check returned: $HEALTH_STATUS"
    fi
else
    print_status 1 "Health endpoint not accessible"
fi

# Test metrics endpoint
echo -e "\n📊 Testing metrics endpoint..."
if curl -s http://localhost:4000/metrics | head -1 | grep -q "#"; then
    print_status 0 "Metrics endpoint working"
else
    print_status 1 "Metrics endpoint not working"
fi

# Check logs directory
echo -e "\n📝 Checking logs directory..."
if [ -d "logs" ] && [ -f "logs/.gitkeep" ]; then
    print_status 0 "Logs directory exists"

    # Check if log files are being created
    LOG_FILES=$(find logs -name "*.log" -type f 2>/dev/null | wc -l)
    if [ "$LOG_FILES" -gt 0 ]; then
        print_status 0 "Log files are being created ($LOG_FILES files)"
        echo "Log files:"
        ls -la logs/*.log 2>/dev/null || echo "No .log files yet"
    else
        echo -e "${YELLOW}⚠️  No log files created yet (this is normal for new deployments)${NC}"
    fi
else
    print_status 1 "Logs directory missing"
fi

# Test API documentation
echo -e "\n📚 Testing API documentation..."
if curl -s http://localhost:4000/api-docs > /dev/null 2>&1; then
    print_status 0 "API documentation accessible"
else
    print_status 1 "API documentation not accessible"
fi

# Check database connectivity
echo -e "\n🗄️  Checking database connectivity..."
if docker exec gps-postgres pg_isready -U gps_user -d gps_mock_db > /dev/null 2>&1; then
    print_status 0 "PostgreSQL is accessible"
else
    print_status 1 "PostgreSQL not accessible"
fi

# Check Redis connectivity
echo -e "\n🔴 Checking Redis connectivity..."
if docker exec gps-redis redis-cli ping | grep -q "PONG"; then
    print_status 0 "Redis is accessible"
else
    print_status 1 "Redis not accessible"
fi

# Show recent logs
echo -e "\n📋 Recent API logs:"
docker compose logs --tail=5 api 2>/dev/null || echo "No recent logs"

echo -e "\n======================================================"
echo -e "${GREEN}🎉 Verification complete!${NC}"
echo ""
echo "If all checks passed, your Docker setup is working correctly."
echo "If you see any ❌ errors, check the troubleshooting section in DOCKER_SETUP.md"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f api          # Follow API logs"
echo "  docker compose logs -f postgres     # Follow DB logs"
echo "  docker compose logs -f redis        # Follow Redis logs"
echo "  curl localhost:4000/health          # Quick health check"
echo "  curl localhost:4000/metrics         # View metrics"