# OpenRouteService Route Creation - API Examples

This document provides example curl commands to test the new `/api/routes/from-addresses` endpoint.

## Prerequisites

1. **Authentication**: You need a valid JWT token. Login first:
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

Save the `token` from the response.

2. **Set your token** (replace `YOUR_JWT_TOKEN` below):
```bash
export JWT_TOKEN="YOUR_JWT_TOKEN"
```

---

## Example 1: Basic Route Creation

Create a route from Santo Domingo to Santiago (República Dominicana):

```bash
curl -X POST http://localhost:4000/api/routes/from-addresses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Ruta Santo Domingo - Santiago",
    "originText": "Santo Domingo, República Dominicana",
    "destinationText": "Santiago, República Dominicana",
    "profile": "driving-car",
    "pointSpacingMeters": 15
  }'
```

**Expected Response** (201 Created):
```json
{
  "success": true,
  "message": "Route created from addresses",
  "data": {
    "routeId": "abc-123-def-456",
    "name": "Ruta Santo Domingo - Santiago",
    "distanceM": 155000,
    "durationS": 7200,
    "pointsCount": 10334,
    "pointSpacingMeters": 15
  }
}
```

---

## Example 2: Route with Wait Time at End

Create a route with a 30-second wait at destination:

```bash
curl -X POST http://localhost:4000/api/routes/from-addresses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Delivery Route - Warehouse to Customer",
    "originText": "Avenida 27 de Febrero, Santo Domingo",
    "destinationText": "Punta Cana, La Altagracia",
    "profile": "driving-car",
    "pointSpacingMeters": 20,
    "waitAtEndSeconds": 30
  }'
```

---

## Example 3: Different Routing Profiles

### Truck/HGV Route
```bash
curl -X POST http://localhost:4000/api/routes/from-addresses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originText": "Puerto de Haina",
    "destinationText": "Zona Franca de Santiago",
    "profile": "driving-hgv",
    "pointSpacingMeters": 25
  }'
```

### Cycling Route
```bash
curl -X POST http://localhost:4000/api/routes/from-addresses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originText": "Parque Colón, Santo Domingo",
    "destinationText": "Malecón de Santo Domingo",
    "profile": "cycling-regular",
    "pointSpacingMeters": 10
  }'
```

### Walking Route
```bash
curl -X POST http://localhost:4000/api/routes/from-addresses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originText": "Plaza de la Cultura, Santo Domingo",
    "destinationText": "Palacio Nacional, Santo Domingo",
    "profile": "foot-walking",
    "pointSpacingMeters": 5
  }'
```

---

## Example 4: Retrieve Created Route

After creating a route, retrieve it with all points:

```bash
curl -X GET http://localhost:4000/api/routes/{routeId} \
  -H "Authorization: Bearer $JWT_TOKEN"
```

---

## Example 5: Assign Route to Device and Start Stream

1. **Assign route to device**:
```bash
curl -X POST http://localhost:4000/api/devices/{deviceId}/route \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "routeId": "abc-123-def-456"
  }'
```

2. **Start streaming the route**:
```bash
curl -X POST http://localhost:4000/api/stream/start \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "your-device-id",
    "speed": 50,
    "loop": false
  }'
```

The Android device will now receive `MOCK_LOCATION` messages via WebSocket following the ORS-generated route.

---

## Available Routing Profiles

| Profile | Description |
|---------|-------------|
| `driving-car` | Standard car routing (default) |
| `driving-hgv` | Heavy goods vehicle routing |
| `cycling-regular` | Regular bicycle |
| `cycling-road` | Road cycling |
| `cycling-mountain` | Mountain biking |
| `cycling-electric` | E-bike |
| `foot-walking` | Walking |
| `foot-hiking` | Hiking trails |
| `wheelchair` | Wheelchair accessible routes |

---

## Error Handling Examples

### Invalid Address
```bash
curl -X POST http://localhost:4000/api/routes/from-addresses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originText": "asdfasdfasdfasdf",
    "destinationText": "qwerqwerqwerqwer"
  }'
```

**Expected Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "Geocoding failed: No results found for address: asdfasdfasdfasdf"
}
```

### Missing Required Fields
```bash
curl -X POST http://localhost:4000/api/routes/from-addresses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Incomplete Route"
  }'
```

**Expected Response** (400 Bad Request):
```json
{
  "success": false,
  "error": "originText and destinationText are required"
}
```

### Rate Limit Exceeded
After 20+ requests in 60 seconds:

**Expected Response** (429 Too Many Requests):
```json
{
  "success": false,
  "error": "Rate limit exceeded. Try again later.",
  "retryAfter": 45
}
```

---

## Testing Geocoding Cache

Run the same request twice to see caching in action:

```bash
# First request (calls ORS API - slower)
time curl -X POST http://localhost:4000/api/routes/from-addresses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originText": "Santo Domingo, DO",
    "destinationText": "Santiago, DO"
  }'

# Second request (uses Redis cache - faster)
time curl -X POST http://localhost:4000/api/routes/from-addresses \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "originText": "Santo Domingo, DO",
    "destinationText": "Santiago, DO"
  }'
```

Check server logs to see:
```
[ORS] Geocoding: Santo Domingo, DO
[ORS] Cached geocoding result for: Santo Domingo, DO
[ORS] Geocoding cache hit: Santo Domingo, DO   <-- Second request uses cache
```

---

## Example 6: Address Autocomplete

Get address suggestions as the user types (useful for frontend autocomplete):

### Basic Autocomplete
```bash
curl -X GET "http://localhost:4000/api/geocode/autocomplete?q=bronx&limit=6" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Expected Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "suggestions": [
      {
        "label": "Bronx County, NY, USA",
        "lat": 40.849285,
        "lng": -73.860478
      },
      {
        "label": "Bronx, New York, NY, USA",
        "lat": 40.853551,
        "lng": -73.874979
      },
      {
        "label": "Bronxdale, Bronx, New York, NY, USA",
        "lat": 40.852123,
        "lng": -73.851698
      }
    ]
  }
}
```

### Autocomplete with Country Filter
Filter results to a specific country (e.g., Dominican Republic):

```bash
curl -X GET "http://localhost:4000/api/geocode/autocomplete?q=santo&limit=5&country=DO" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Response**:
```json
{
  "success": true,
  "data": {
    "suggestions": [
      {
        "label": "Santo Domingo, Dominican Republic",
        "lat": 18.471621,
        "lng": -69.89213
      },
      {
        "label": "Santo Domingo Oeste, SD, Dominican Republic",
        "lat": 18.500854,
        "lng": -69.990807
      },
      {
        "label": "Santo Domingo Este, SD, Dominican Republic",
        "lat": 18.486858,
        "lng": -69.857035
      }
    ]
  }
}
```

### Common Country Codes
- `US` - United States
- `DO` - Dominican Republic
- `MX` - Mexico
- `ES` - Spain
- `FR` - France
- `DE` - Germany

### Autocomplete Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query (min 3 characters) |
| `limit` | number | No | 6 | Max suggestions (1-20) |
| `country` | string | No | - | ISO country code filter |

### Error Cases

**Query too short**:
```bash
curl -X GET "http://localhost:4000/api/geocode/autocomplete?q=ab" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Response (400 Bad Request):
```json
{
  "success": false,
  "message": "Query must be at least 3 characters"
}
```

**Missing query**:
```bash
curl -X GET "http://localhost:4000/api/geocode/autocomplete" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Response (400 Bad Request):
```json
{
  "success": false,
  "message": "Query parameter \"q\" is required"
}
```

### Autocomplete Cache

Like geocoding, autocomplete results are cached in Redis for 24 hours:

```bash
# First call: Queries ORS API
curl -X GET "http://localhost:4000/api/geocode/autocomplete?q=new+york&limit=3" \
  -H "Authorization: Bearer $JWT_TOKEN"

# Second call: Uses Redis cache (much faster)
curl -X GET "http://localhost:4000/api/geocode/autocomplete?q=new+york&limit=3" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

Check logs to see cache hit:
```
[ORS] Autocomplete: new york
[ORS] Cached autocomplete result for: new york (3 results)
[ORS] Autocomplete cache hit: new york  <-- Second request
```

### Frontend Integration Example

TypeScript/React example:
```typescript
async function searchAddresses(query: string) {
  if (query.length < 3) return [];
  
  const response = await fetch(
    `http://localhost:4000/api/geocode/autocomplete?q=${encodeURIComponent(query)}&limit=8`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );
  
  const data = await response.json();
  return data.data.suggestions;
}

// Usage in autocomplete component
<Autocomplete
  onSearch={searchAddresses}
  onSelect={(suggestion) => {
    setOrigin({
      address: suggestion.label,
      lat: suggestion.lat,
      lng: suggestion.lng
    });
  }}
/>
```

---

## Notes


- **Rate Limiting**: Maximum 20 requests per user per minute
- **Cache**: Geocoding results cached for 24 hours in Redis
- **Point Spacing**: Default is 15 meters if not specified
- **Security**: ORS API key is never exposed to frontend
- **Route Integration**: After creation, use the `routeId` like any other route in the system
