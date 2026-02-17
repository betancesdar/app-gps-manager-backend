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
        $jsonBody = $Body | ConvertTo-Json -Depth 5
        Write-Host "   Invoking $Method $Uri"
        $response = Invoke-RestMethod -Uri $Uri -Method $Method -ContentType "application/json" -Headers $Headers -Body $jsonBody
        return $response
    } catch {
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
$loginResponse = Invoke-Api -Uri "$baseUrl/auth/login" -Method Post -Body @{username="admin"; password="admin123"}
$token = $loginResponse.data.token
$headers = @{ "Authorization" = "Bearer $token" }
Write-Host "   ✅ Token received."

Write-Host "2. Registering Device..."
$deviceResponse = Invoke-Api -Uri "$baseUrl/devices/register" -Method Post -Headers $headers -Body @{ deviceId = "test-device-auto"; platform = "android" }
Write-Host "   ✅ Device registered: $($deviceResponse.data.deviceId)"

Write-Host "3. Creating Route..."
$routeBody = @{
    name = "Auto Integration Route";
    points = @(
        @{ lat = 18.4861; lng = -69.9312 },
        @{ lat = 18.4865; lng = -69.9315 }
    )
}
$routeResponse = Invoke-Api -Uri "$baseUrl/routes/from-points" -Method Post -Headers $headers -Body $routeBody
$routeId = $routeResponse.data.routeId
Write-Host "   ✅ Route created: $routeId"

Write-Host "4. Assigning Route to Device..."
$assignResponse = Invoke-Api -Uri "$baseUrl/devices/test-device-auto/route" -Method Put -Headers $headers -Body @{ routeId = $routeId }
Write-Host "   ✅ Route assigned: $($assignResponse.data.assignedRoute.id)"

Write-Host "5. Starting Stream (No Route ID)..."
try {
    $streamResponse = Invoke-RestMethod -Uri "$baseUrl/stream/start" -Method Post -ContentType "application/json" -Headers $headers -Body (@{ deviceId = "test-device-auto"; speed = 60; loop = $true } | ConvertTo-Json)
    Write-Host "   ✅ Stream started: $($streamResponse.data.status)"
} catch {
    Write-Host "   ⚠️ Stream start failed (Expected if WS not connected): $($_.Exception.Message)"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "   ⚠️ Response Body: $responseBody"
    }
}
