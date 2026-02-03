/**
 * Swagger Configuration
 * API Documentation for GPS Mock Location Backend
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'GPS Mock Location Backend API',
            version: '1.0.0',
            description: 'API para controlar Mock Location en tiempo real para dispositivos Android',
        },
        servers: [
            {
                url: 'http://localhost:4000',
                description: 'Development server',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [
            {
                bearerAuth: [],
            },
        ],
        tags: [
            { name: 'Auth', description: 'Autenticación' },
            { name: 'Devices', description: 'Gestión de dispositivos' },
            { name: 'Routes', description: 'Gestión de rutas GPS' },
            { name: 'Stream', description: 'Streaming en tiempo real' },
        ],
        paths: {
            '/health': {
                get: {
                    summary: 'Health check',
                    tags: ['Health'],
                    security: [],
                    responses: {
                        200: {
                            description: 'Server is running',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            status: { type: 'string', example: 'ok' },
                                            timestamp: { type: 'string' },
                                            uptime: { type: 'number' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/api/auth/login': {
                post: {
                    summary: 'Login y obtener token JWT',
                    tags: ['Auth'],
                    security: [],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['username', 'password'],
                                    properties: {
                                        username: { type: 'string', example: 'admin' },
                                        password: { type: 'string', example: 'admin123' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: {
                            description: 'Login exitoso',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            success: { type: 'boolean' },
                                            data: {
                                                type: 'object',
                                                properties: {
                                                    token: { type: 'string' },
                                                    user: { type: 'object' },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            '/api/devices/register': {
                post: {
                    summary: 'Registrar un dispositivo',
                    tags: ['Devices'],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        deviceId: { type: 'string', example: 'android-001' },
                                        platform: { type: 'string', example: 'android' },
                                        appVersion: { type: 'string', example: '1.0.0' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        201: { description: 'Device registrado' },
                    },
                },
            },
            '/api/devices': {
                get: {
                    summary: 'Listar todos los dispositivos',
                    tags: ['Devices'],
                    responses: {
                        200: { description: 'Lista de dispositivos' },
                    },
                },
            },
            '/api/devices/{deviceId}': {
                get: {
                    summary: 'Obtener dispositivo por ID',
                    tags: ['Devices'],
                    parameters: [
                        {
                            name: 'deviceId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    responses: {
                        200: { description: 'Dispositivo encontrado' },
                        404: { description: 'Dispositivo no encontrado' },
                    },
                },
                delete: {
                    summary: 'Eliminar dispositivo',
                    tags: ['Devices'],
                    parameters: [
                        {
                            name: 'deviceId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    responses: {
                        200: { description: 'Dispositivo eliminado' },
                    },
                },
            },
            '/api/routes/from-points': {
                post: {
                    summary: 'Crear ruta desde array de puntos',
                    tags: ['Routes'],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['points'],
                                    properties: {
                                        name: { type: 'string', example: 'Mi Ruta' },
                                        points: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    lat: { type: 'number', example: 18.4861 },
                                                    lng: { type: 'number', example: -69.9312 },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        201: { description: 'Ruta creada' },
                    },
                },
            },
            '/api/routes/from-gpx': {
                post: {
                    summary: 'Crear ruta desde contenido GPX',
                    tags: ['Routes'],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['gpxContent'],
                                    properties: {
                                        name: { type: 'string' },
                                        gpxContent: { type: 'string', example: '<?xml...' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        201: { description: 'Ruta creada desde GPX' },
                    },
                },
            },
            '/api/routes': {
                get: {
                    summary: 'Listar todas las rutas',
                    tags: ['Routes'],
                    responses: {
                        200: { description: 'Lista de rutas' },
                    },
                },
            },
            '/api/routes/{routeId}': {
                get: {
                    summary: 'Obtener ruta por ID',
                    tags: ['Routes'],
                    parameters: [
                        {
                            name: 'routeId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    responses: {
                        200: { description: 'Ruta encontrada' },
                    },
                },
                delete: {
                    summary: 'Eliminar ruta',
                    tags: ['Routes'],
                    parameters: [
                        {
                            name: 'routeId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    responses: {
                        200: { description: 'Ruta eliminada' },
                    },
                },
            },
            '/api/routes/{routeId}/config': {
                put: {
                    summary: 'Configurar ruta (velocidad, loop, etc)',
                    tags: ['Routes'],
                    parameters: [
                        {
                            name: 'routeId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    requestBody: {
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        speed: { type: 'number', example: 30 },
                                        accuracy: { type: 'number', example: 5 },
                                        loop: { type: 'boolean', example: true },
                                        intervalMs: { type: 'number', example: 1000 },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'Configuración actualizada' },
                    },
                },
            },
            '/api/stream/start': {
                post: {
                    summary: 'Iniciar streaming a dispositivo',
                    tags: ['Stream'],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['deviceId', 'routeId'],
                                    properties: {
                                        deviceId: { type: 'string', example: 'android-001' },
                                        routeId: { type: 'string' },
                                        speed: { type: 'number', example: 30 },
                                        loop: { type: 'boolean', example: true },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'Stream iniciado' },
                    },
                },
            },
            '/api/stream/pause': {
                post: {
                    summary: 'Pausar streaming',
                    tags: ['Stream'],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['deviceId'],
                                    properties: {
                                        deviceId: { type: 'string', example: 'android-001' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'Stream pausado' },
                    },
                },
            },
            '/api/stream/resume': {
                post: {
                    summary: 'Reanudar streaming',
                    tags: ['Stream'],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['deviceId'],
                                    properties: {
                                        deviceId: { type: 'string', example: 'android-001' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'Stream reanudado' },
                    },
                },
            },
            '/api/stream/stop': {
                post: {
                    summary: 'Detener streaming',
                    tags: ['Stream'],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    required: ['deviceId'],
                                    properties: {
                                        deviceId: { type: 'string', example: 'android-001' },
                                    },
                                },
                            },
                        },
                    },
                    responses: {
                        200: { description: 'Stream detenido' },
                    },
                },
            },
            '/api/stream/status/{deviceId}': {
                get: {
                    summary: 'Obtener estado del streaming',
                    tags: ['Stream'],
                    parameters: [
                        {
                            name: 'deviceId',
                            in: 'path',
                            required: true,
                            schema: { type: 'string' },
                        },
                    ],
                    responses: {
                        200: { description: 'Estado del stream' },
                    },
                },
            },
            '/api/stream/all': {
                get: {
                    summary: 'Listar todos los streams activos',
                    tags: ['Stream'],
                    responses: {
                        200: { description: 'Lista de streams' },
                    },
                },
            },
        },
    },
    apis: [],
};

const specs = swaggerJsdoc(options);

module.exports = specs;
