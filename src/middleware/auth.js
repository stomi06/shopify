const { getSessionFromStorage } = require('../auth/shopifyAuth');
const { hasActiveSubscription } = require('../../db');

/**
 * Middleware do sprawdzania sesji Shopify
 */
const requireSession = (req, res, next) => {
  try {
    // W trybie testowym zawsze pozwalaj na dostęp
    if (!res.locals) res.locals = {};
    if (!res.locals.shopify) res.locals.shopify = {};
    
    // Ustaw testową sesję
    res.locals.shopify.session = {
      shop: req.query.shop || req.body.shop || 'test-shop.myshopify.com',
      accessToken: 'test_token',
      isActive: () => true
    };
    
    // Kontynuuj
    next();
  } catch (error) {
    console.error('Session error:', error);
    res.status(401).json({ 
      error: 'Authentication error',
      message: error.message 
    });
  }
};

/**
 * Middleware do sprawdzania subskrypcji
 */
const requireSubscription = async (req, res, next) => {
  const shop = req.query.shop || req.body.shop;
  if (!shop) {
    return res.status(400).json({ error: 'Brak parametru shop' });
  }
  
  const session = await getSessionFromStorage(shop);
  if (!session) {
    return res.status(401).json({ error: 'Brak autoryzacji' });
  }
  
  const isActive = await hasActiveSubscription(session);
  
  if (!isActive) {
    return res.status(403).json({ 
      error: 'Brak aktywnej subskrypcji',
      subscriptionRequired: true
    });
  }
  
  next();
};

/**
 * Middleware do obsługi CORS
 */
const corsMiddleware = (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
};

module.exports = {
  requireSession,
  requireSubscription,
  corsMiddleware
};
