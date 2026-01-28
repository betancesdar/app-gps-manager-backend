# GPS Mock Location Backend

Backend Node.js/Express para controlar Mock Location en tiempo real para dispositivos Android.

## 🚀 Quick Start

```bash
# Instalar dependencias
npm install

# Iniciar servidor (desarrollo)
npm run dev

# Servidor corriendo en http://localhost:4000
```

## 📋 Variables de Entorno (.env)

```env
PORT=4000
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=7d
```

---

## 🔐 Autenticación

### Login
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1...",
    "user": { "username": "admin", "role": "admin" }
  }
}
```

> ⚠️ Usa el token en todas las demás peticiones: `Authorization: Bearer <TOKEN>`

---

## 📱 Dispositivos

### Registrar dispositivo
```bash
curl -X POST http://localhost:4000/api/devices/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "deviceId": "android-001",
    "platform": "android",
    "appVersion": "1.0.0"
  }'
```

### Listar dispositivos
```bash
curl http://localhost:4000/api/devices \
  -H "Authorization: Bearer <TOKEN>"
```

### Obtener dispositivo
```bash
curl http://localhost:4000/api/devices/android-001 \
  -H "Authorization: Bearer <TOKEN>"
```

### Eliminar dispositivo
```bash
curl -X DELETE http://localhost:4000/api/devices/android-001 \
  -H "Authorization: Bearer <TOKEN>"
```

---

## 🛣️ Rutas GPS

### Crear ruta desde array de puntos
```bash
curl -X POST http://localhost:4000/api/routes/from-points \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "name": "Mi Ruta",
    "points": [
      {"lat": 18.4861, "lng": -69.9312},
      {"lat": 18.4871, "lng": -69.9322},
      {"lat": 18.4881, "lng": -69.9332}
    ]
  }'
```

### Crear ruta desde GPX
```bash
curl -X POST http://localhost:4000/api/routes/from-gpx \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "name": "Ruta GPX",
    "gpxContent": "<?xml version=\"1.0\"?><gpx><trk><trkseg><trkpt lat=\"18.4861\" lon=\"-69.9312\"/></trkseg></trk></gpx>"
  }'
```

### Listar rutas
```bash
curl http://localhost:4000/api/routes \
  -H "Authorization: Bearer <TOKEN>"
```

### Configurar ruta (velocidad, loop, etc.)
```bash
curl -X PUT http://localhost:4000/api/routes/<ROUTE_ID>/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "speed": 50,
    "accuracy": 3,
    "loop": true,
    "intervalMs": 1000
  }'
```

---

## 📡 Streaming en Tiempo Real

### Iniciar streaming
```bash
curl -X POST http://localhost:4000/api/stream/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "deviceId": "android-001",
    "routeId": "<ROUTE_ID>",
    "speed": 30,
    "loop": true
  }'
```

### Pausar streaming
```bash
curl -X POST http://localhost:4000/api/stream/pause \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"deviceId": "android-001"}'
```

### Reanudar streaming
```bash
curl -X POST http://localhost:4000/api/stream/resume \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"deviceId": "android-001"}'
```

### Detener streaming
```bash
curl -X POST http://localhost:4000/api/stream/stop \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"deviceId": "android-001"}'
```

### Ver estado del streaming
```bash
curl http://localhost:4000/api/stream/status/android-001 \
  -H "Authorization: Bearer <TOKEN>"
```

---

## 🔌 WebSocket

### Conectar desde terminal (wscat)
```bash
npx wscat -c "ws://localhost:4000/ws?token=<TOKEN>&deviceId=android-001"
```

### Conectar desde Android/JavaScript
```javascript
const ws = new WebSocket('ws://localhost:4000/ws?token=TOKEN&deviceId=android-001');

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  
  if (message.type === 'MOCK_LOCATION') {
    // Aplicar mock location
    const { lat, lng, speed, bearing, accuracy } = message.payload;
    console.log(`Location: ${lat}, ${lng} | Bearing: ${bearing}° | Speed: ${speed}`);
  }
};
```

### Formato de mensaje MOCK_LOCATION
```json
{
  "type": "MOCK_LOCATION",
  "payload": {
    "lat": 18.4861,
    "lng": -69.9312,
    "speed": 30,
    "bearing": 120,
    "accuracy": 5
  },
  "meta": {
    "pointIndex": 0,
    "totalPoints": 100,
    "routeId": "uuid",
    "timestamp": "2024-01-27T10:00:00Z"
  }
}
```

---

## 📁 Estructura del Proyecto

```
src/
├── server.js           # Entry point
├── app.js              # Express configuration
├── config/
│   └── config.js       # Centralized config
├── routes/
│   ├── auth.routes.js
│   ├── device.routes.js
│   ├── route.routes.js
│   └── stream.routes.js
├── controllers/
│   ├── auth.controller.js
│   ├── device.controller.js
│   ├── route.controller.js
│   └── stream.controller.js
├── services/
│   ├── device.service.js
│   ├── route.service.js
│   └── stream.service.js
├── middleware/
│   └── auth.middleware.js
├── utils/
│   ├── jwt.util.js
│   └── gpx.parser.js
└── websocket/
    └── ws.server.js
```

---

## 🎯 Flujo de Uso

1. **Login** → Obtener token JWT
2. **Registrar device** → Con deviceId de Android
3. **Conectar WebSocket** → Desde la app Android
4. **Crear ruta** → Desde puntos o GPX
5. **Iniciar stream** → El device recibe MOCK_LOCATION
6. **Android ejecuta mock** → Con lat, lng, bearing, accuracy

---

## 📝 Notas

- **Sin base de datos**: Todo se almacena en memoria (Map)
- **Puerto**: 4000
- **WebSocket path**: `/ws`
- **Autenticación**: JWT en header o query param
