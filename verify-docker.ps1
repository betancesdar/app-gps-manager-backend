# Docker Verification Script for GPS Mock Location Backend
# Run this after applying Docker changes to verify everything works
# Usage: .\verify-docker.ps1

Write-Host "🔍 Verifying GPS Mock Location Backend Docker Setup..." -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan

# Function to print status
function Print-Status {
    param(
        [bool]$Success,
        [string]$Message
    )
    if ($Success) {
        Write-Host "✅ $Message" -ForegroundColor Green
    }
    else {
        Write-Host "❌ $Message" -ForegroundColor Red
    }
}

# Check if Docker is running
Write-Host "`n📦 Checking Docker status..." -ForegroundColor Yellow
try {
    $dockerInfo = docker info 2>$null
    if ($LASTEXITCODE -eq 0) {
        Print-Status $true "Docker is running"
    }
    else {
        Print-Status $false "Docker is not running"
        exit 1
    }
}
catch {
    Print-Status $false "Docker is not installed or not in PATH"
    exit 1
}

# Check if containers are up
Write-Host "`n🏗️  Checking container status..." -ForegroundColor Yellow
$containers = docker compose ps 2>$null
if ($containers -match "Up") {
    Print-Status $true "Containers are running"
}
else {
    Print-Status $false "No containers are running"
    Write-Host "Run: docker compose up --build -d" -ForegroundColor Yellow
    exit 1
}

Write-Host "Container Status:"
docker compose ps

# Wait for services to be ready
Write-Host "`n⏳ Waiting for services to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Test health endpoint
Write-Host "`n🏥 Testing health endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4000/health" -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($null -ne $response) {
        $health = $response.Content | ConvertFrom-Json
        $status = $health.status
        if ($status -eq "ok") {
            Print-Status $true "Health check passed"
            Write-Host "Database: $($health.database)" -ForegroundColor Gray
            Write-Host "Redis: $($health.redis)" -ForegroundColor Gray
            Write-Host "Memory: $($health.memory)" -ForegroundColor Gray
        }
        else {
            Print-Status $false "Health check returned: $status"
        }
    }
    else {
        Print-Status $false "Health endpoint not accessible"
    }
}
catch {
    Print-Status $false "Health endpoint not accessible"
}

# Test metrics endpoint
Write-Host "`n📊 Testing metrics endpoint..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4000/metrics" -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($null -ne $response -and $response.Content -match "^#") {
        Print-Status $true "Metrics endpoint working"
    }
    else {
        Print-Status $false "Metrics endpoint not working"
    }
}
catch {
    Print-Status $false "Metrics endpoint not accessible"
}

# Check logs directory
Write-Host "`n📝 Checking logs directory..." -ForegroundColor Yellow
if ((Test-Path "logs") -and (Test-Path "logs\.gitkeep")) {
    Print-Status $true "Logs directory exists"
    
    # Check if log files are being created
    $logFiles = @(Get-ChildItem -Path "logs" -Filter "*.log" -ErrorAction SilentlyContinue)
    if ($logFiles.Count -gt 0) {
        Print-Status $true "Log files are being created ($($logFiles.Count) files)"
        Write-Host "Log files:" -ForegroundColor Gray
        $logFiles | ForEach-Object { Write-Host "  - $($_.Name) ($('{0:N0}' -f $_.Length) bytes)" -ForegroundColor Gray }
    }
    else {
        Write-Host "⚠️  No log files created yet (this is normal for new deployments)" -ForegroundColor Yellow
    }
}
else {
    Print-Status $false "Logs directory missing"
}

# Test API documentation
Write-Host "`n📚 Testing API documentation..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:4000/api-docs" -TimeoutSec 5 -ErrorAction SilentlyContinue
    if ($null -ne $response) {
        Print-Status $true "API documentation accessible"
    }
    else {
        Print-Status $false "API documentation not accessible"
    }
}
catch {
    Print-Status $false "API documentation not accessible"
}

# Check database connectivity
Write-Host "`n🗄️  Checking database connectivity..." -ForegroundColor Yellow
try {
    $dbCheck = docker exec gps-postgres pg_isready -U gps_user -d gps_mock_db 2>$null
    if ($LASTEXITCODE -eq 0) {
        Print-Status $true "PostgreSQL is accessible"
    }
    else {
        Print-Status $false "PostgreSQL not accessible"
    }
}
catch {
    Print-Status $false "PostgreSQL not accessible"
}

# Check Redis connectivity
Write-Host "`n🔴 Checking Redis connectivity..." -ForegroundColor Yellow
try {
    $redisCheck = docker exec gps-redis redis-cli ping 2>$null
    if ($redisCheck -match "PONG") {
        Print-Status $true "Redis is accessible"
    }
    else {
        Print-Status $false "Redis not accessible"
    }
}
catch {
    Print-Status $false "Redis not accessible"
}

# Show recent logs
Write-Host "`n📋 Recent API logs:" -ForegroundColor Yellow
docker compose logs --tail=10 api 2>$null

Write-Host "`n======================================================" -ForegroundColor Cyan
Write-Host "🎉 Verification complete!" -ForegroundColor Green
Write-Host ""
Write-Host "If all checks passed, your Docker setup is working correctly."
Write-Host "If you see any ❌ errors, check the DOCKER_SETUP.md file for troubleshooting."
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Yellow
Write-Host "  docker compose logs -f api          # Follow API logs"
Write-Host "  docker compose logs -f postgres     # Follow DB logs"
Write-Host "  docker compose logs -f redis        # Follow Redis logs"
Write-Host "  curl localhost:4000/health          # Quick health check"
Write-Host "  curl localhost:4000/metrics         # View metrics"
