$ErrorActionPreference = "Stop"
$baseUrl = "http://localhost:4000/api"

function Invoke-Api {
    param(
        [string]$Uri,
        [string]$Method,
        [hashtable]$Body,
        [hashtable]$Headers
    )
    try {
        $jsonBody = $Body | ConvertTo-Json -Depth 10
        Write-Host "   Invoking $Method $Uri"
        $response = Invoke-RestMethod -Uri $Uri -Method $Method -ContentType "application/json" -Headers $Headers -Body $jsonBody
        return $response
    }
    catch {
        Write-Host "   ❌ Error: $($_.Exception.Message)"
        if ($_.Exception.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $responseBody = $reader.ReadToEnd()
            Write-Host "   ❌ Response Body: $responseBody"
        }
        exit 1
    }
}

Write-Host "1. Logging in..."
$loginResponse = Invoke-Api -Uri "$baseUrl/auth/login" -Method Post -Body @{username = "admin"; password = "admin123" }
$token = $loginResponse.data.token
$headers = @{ "Authorization" = "Bearer $token" }
Write-Host "   ✅ Token received."

Write-Host "2. Creating Route with Stops..."
# Stop 1: Address (Santo Domingo)
# Stop 2: Manual (Simulated midpoint)
# Stop 3: Address (Boca Chica)
# Wait 5 seconds at Stop 2
$stopsBody = @{
    name               = "Test Multi-Stop Route";
    pointSpacingMeters = 50;
    stops              = @(
        @{ text = "Av. Winston Churchill, Santo Domingo"; label = "Start (Churchill)" },
        @{ lat = 18.47186; lng = -69.91158; waitSeconds = 5; label = "Manual Stop (Midpoint)" },
        @{ text = "Boca Chica, Dominican Republic"; label = "End (Boca Chica)" }
    )
}

$routeResponse = Invoke-Api -Uri "$baseUrl/routes/from-addresses-with-stops" -Method Post -Headers $headers -Body $stopsBody
$routeId = $routeResponse.data.routeId
$pointCount = $routeResponse.data.pointsCount
$duration = $routeResponse.data.durationS

Write-Host "   ✅ Route created: $routeId"
Write-Host "   ℹ️  Total Points: $pointCount"
Write-Host "   ℹ️  Total Duration: ${duration}s"

# Validation
if ($pointCount -lt 10) {
    Write-Error "Point count too low, something is wrong."
}

Write-Host "3. Verifying Route Details..."
$detailsResponse = Invoke-Api -Uri "$baseUrl/routes/$routeId" -Method Get -Headers $headers
$points = $detailsResponse.data.points
$lastPoints = $points | Select-Object -Last 10

Write-Host "   ✅ Route details retrieved."

Write-Host "DONE."
