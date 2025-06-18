const crypto = require('crypto');

/**
 * Generate a cryptographically secure nonce
 */
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Validate Shopify HMAC
 */
function verifyShopifyHmac(data, hmacHeader, secret) {
  const calculatedHmac = crypto
    .createHmac('sha256', secret)
    .update(data, 'utf8')
    .digest('base64');
  
  return crypto.timingSafeEqual(
    Buffer.from(calculatedHmac, 'base64'),
    Buffer.from(hmacHeader, 'base64')
  );
}

/**
 * Get session from storage (simplified for development)
 */
const sessionStore = {};

async function getSessionFromStorage(shop) {
  if (!shop) return null;
  
  // W fazie rozwojowej, zawsze zwracaj testową sesję
  if (process.env.NODE_ENV !== 'production') {
    return {
      shop: shop,
      accessToken: 'test_token',
      isActive: () => true,
      isOnline: true
    };
  }
  
  // W rzeczywistej aplikacji, pobierz sesję z SessionStorage
  return sessionStore[shop] || null;
}

/**
 * Save session to storage
 */
async function saveSessionToStorage(shop, session) {
  sessionStore[shop] = session;
}

module.exports = {
  generateNonce,
  verifyShopifyHmac,
  getSessionFromStorage,
  saveSessionToStorage
};
