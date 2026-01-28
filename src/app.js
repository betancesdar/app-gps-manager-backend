/**
 * Express Application
 * Main app configuration with routes and middleware
 */

const express = require('express');
const cors = require('cors');

// Import routes
const authRoutes = require('./routes/auth.routes');
const deviceRoutes = require('./routes/device.routes');
const routeRoutes = require('./routes/route.routes');
const streamRoutes = require('./routes/stream.routes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased for GPX files
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/stream', streamRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

module.exports = app;