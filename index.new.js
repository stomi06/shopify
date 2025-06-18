require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const { PORT } = require('./src/config/shopify');
const { corsMiddleware } = require('./src/middleware/auth');

// Import route'ów
const authRoutes = require('./src/routes/auth');
const appProxyRoutes = require('./src/routes/appProxy');
const apiRoutes = require('./src/routes/api');
const subscriptionRoutes = require('./src/routes/subscription');
const javascriptRoutes = require('./src/routes/javascript');
const webhookRoutes = require('./src/routes/webhooks');

const app = express();

// Middleware
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));
app.use(corsMiddleware);

// Routes
app.use('/', authRoutes);           // /auth, /auth/callback
app.use('/', appProxyRoutes);       // /free-delivery/settings
app.use('/', apiRoutes);            // /api/settings, /api/settings/update
app.use('/', subscriptionRoutes);   // /api/subscription/*
app.use('/', javascriptRoutes);     // /free-shipping-bar.js
app.use('/', webhookRoutes);        // /webhooks/*

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Free Delivery Bar App listening on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
