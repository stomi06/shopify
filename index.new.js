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

// DEBUGGING - dodaj to na samym początku
app.use((req, res, next) => {
  console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  
  if (req.path.includes('free-delivery')) {
    console.log('🎯 FREE-DELIVERY REQUEST DETECTED:', {
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-shopify-shop-domain': req.headers['x-shopify-shop-domain'],
        'x-shopify-hmac-sha256': req.headers['x-shopify-hmac-sha256']
      },
      query: req.query
    });
  }
  next();
});

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

// Catch-all dla debugging (na końcu)
app.all('/free-delivery*', (req, res) => {
  console.log('🚨 CATCH-ALL HIT (nie znaleziono route):', req.method, req.originalUrl);
  res.status(404).json({ 
    error: 'Route not found',
    debug: 'Catch-all endpoint', 
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    query: req.query,
    timestamp: new Date().toISOString()
  });
});

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
