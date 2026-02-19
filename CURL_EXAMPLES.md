# GPS Mock Location Backend — curl Examples

All examples assume the server is running on `http://localhost:4000`.
Replace `<TOKEN>` with the JWT from the login response.

---

## 1. Login (get JWT token)

```bash
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq .
```

---

## 2. Register a Device

```bash
curl -s -X POST http://localhost:4000/api/devices/register \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-001",
    "platform": "android",
    "appVersion": "1.0.0"
  }' | jq .
```

---

## 3. Create Route with Waypoints + Dwell Times

Supports `mode=manual` (lat/lng) and `mode=address` (geocoded via ORS).

```bash
curl -s -X POST http://localhost:4000/api/routes/from-waypoints \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Office Commute",
    "profile": "driving-car",
    "pointSpacingMeters": 30,
    "waypoints": [
      {
        "kind": "origin",
        "mode": "manual",
        "label": "Home",
        "lat": 18.4861,
        "lng": -69.9312,
        "dwellSeconds": 5
      },
      {
        "kind": "stop",
        "mode": "manual",
        "label": "Gas Station",
        "lat": 18.4900,
        "lng": -69.9350,
        "dwellSeconds": 30
      },
      {
        "kind": "destination",
        "mode": "manual",
        "label": "Office",
        "lat": 18.4950,
        "lng": -69.9400,
        "dwellSeconds": 0
      }
    ]
  }' | jq .
```

**Mixed address + manual example:**
```bash
curl -s -X POST http://localhost:4000/api/routes/from-waypoints \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Downtown Route",
    "profile": "driving-car",
    "waypoints": [
      {
        "kind": "origin",
        "mode": "address",
        "label": "Start",
        "text": "Av. Winston Churchill, Santo Domingo",
        "dwellSeconds": 10
      },
      {
        "kind": "destination",
        "mode": "address",
        "label": "End",
        "text": "Av. 27 de Febrero, Santo Domingo",
        "dwellSeconds": 0
      }
    ]
  }' | jq .
```

---

## 4. Assign Route to Device

Idempotent — calling again with a different `routeId` replaces the assignment.

```bash
curl -s -X PUT http://localhost:4000/api/devices/test-device-001/route \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"routeId": "<ROUTE_ID>"}' | jq .
```

---

## 5. Start Stream (uses assigned route if no routeId given)

```bash
# With explicit routeId
curl -s -X POST http://localhost:4000/api/stream/start \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-001",
    "routeId": "<ROUTE_ID>",
    "loop": true
  }' | jq .

# Without routeId — uses device.assignedRouteId
curl -s -X POST http://localhost:4000/api/stream/start \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "test-device-001",
    "loop": true
  }' | jq .
```

---

## 6. WebSocket Connection

### Via headers (Android / production):
```bash
# Using websocat
websocat ws://localhost:4000/ws \
  -H "Authorization: Bearer <TOKEN>" \
  -H "X-Device-Id: test-device-001"
```

### Via query params (tooling / curl):
```bash
# Using wscat
wscat -c "ws://localhost:4000/ws?token=<TOKEN>&deviceId=test-device-001"

# Using websocat
websocat "ws://localhost:4000/ws?token=<TOKEN>&deviceId=test-device-001"
```

**Expected WS messages during dwell:**
```json
{"type":"MOCK_LOCATION","payload":{"lat":18.49,"lng":-69.935,"speed":0,"bearing":45.2,"accuracy":5,"state":"WAIT"},"meta":{"pointIndex":42,"totalPoints":150,"routeId":"...","timestamp":"..."}}
```

**Expected WS messages while moving:**
```json
{"type":"MOCK_LOCATION","payload":{"lat":18.491,"lng":-69.936,"speed":30,"bearing":45.2,"accuracy":5,"state":"MOVE"},"meta":{"pointIndex":43,"totalPoints":150,"routeId":"...","timestamp":"..."}}
```

---

## 7. Stream Control

```bash
# Pause
curl -s -X POST http://localhost:4000/api/stream/pause \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-device-001"}' | jq .

# Resume
curl -s -X POST http://localhost:4000/api/stream/resume \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-device-001"}' | jq .

# Stop
curl -s -X POST http://localhost:4000/api/stream/stop \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-device-001"}' | jq .

# Status
curl -s http://localhost:4000/api/stream/status/test-device-001 \
  -H "Authorization: Bearer <TOKEN>" | jq .
```

---

## 8. Verify DB Tables (Docker)

```bash
docker compose exec postgres psql -U gps_user -d gps_mock_db -c "\dt"
# Should show: users, devices, routes, route_points, route_waypoints, streams, audit_logs

docker compose exec postgres psql -U gps_user -d gps_mock_db \
  -c "SELECT seq, kind, label, lat, lng, dwell_seconds FROM route_waypoints LIMIT 10;"
```

---

## 9. Device Enrollment Flow (Production Identity)

### Step A: Admin Generates Enrollment Code
Protected by Admin JWT.
Rate limit: 10/min.

```bash
curl -s -X POST http://localhost:4000/api/devices/enroll \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"label": "Delivery Truck 5", "requestedDeviceId": "truck-05"}' | jq .
```
**Response:**
```json
{
  "success": true,
  "data": {
    "enrollmentCode": "123456",
    "expiresAt": "2023-10-27T10:15:00.000Z",
    "requestedDeviceId": "truck-05",
    "serverBaseUrl": "http://localhost:4000"
  }
}
```

### Step B: Device Activates Code (Public)
Device sends code and hardware info.

```bash
curl -s -X POST http://localhost:4000/api/devices/activate \
  -H "Content-Type: application/json" \
  -d '{
    "enrollmentCode": "123456",
    "platform": "android",
    "appVersion": "2.1.0",
    "deviceInfo": { "androidId": "a1b2c3d4e5f6" }
  }' | jq .
```
**Response:**
```json
{
  "success": true,
  "data": {
    "deviceId": "truck-05",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": "7d",
    "baseUrl": "http://localhost:4000"
  }
}
```

### Step C: WebSocket Connection
Device connects using the returned token.

**URL:** `ws://localhost:4000/ws`
**Headers:**
```
Authorization: Bearer <DEVICE_TOKEN>
X-Device-Id: truck-05
```

### Step B: Device Activates Code
Public endpoint (no JWT required).

```bash
curl -s -X POST http://localhost:4000/api/devices/activate \
  -H "Content-Type: application/json" \
  -d '{"enrollmentCode": "123456"}' | jq .
```
**Response:**
```json
{
  "success": true,
  "data": {
    "deviceId": "production-device-001",
    "deviceToken": "a1b2c3d4... (long token)"
  }
}
```

### Step C: Device Connects to WebSocket with Device Token
Using the long-lived `deviceToken` obtained in Step B.

```bash
# Headers (Recommended)
websocat ws://localhost:4000/ws \
  -H "Authorization: Bearer <DEVICE_TOKEN>" \
  -H "X-Device-Id: production-device-001"

# URL Params (Tooling)
websocat "ws://localhost:4000/ws?token=<DEVICE_TOKEN>&deviceId=production-device-001"
```

---

## 10. Admin Hygiene

### Cleanup Stale Devices
Remove devices inactive for > 30 days (default) or custom seconds.

```bash
curl -s -X POST http://localhost:4000/api/devices/cleanup-stale \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"olderThanSeconds": 2592000}' | jq .
```

### List Active Devices
Filter by activity.

```bash
curl -s "http://localhost:4000/api/devices?activeWithinSeconds=600" \
  -H "Authorization: Bearer <ADMIN_TOKEN>" | jq .
```
