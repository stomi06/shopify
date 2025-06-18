require('dotenv').config();

module.exports = {
  SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
  SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
  SCOPES: 'write_script_tags,read_script_tags',
  HOST: process.env.HOST,
  PORT: process.env.PORT || 3000,
  
  // Subscription settings
  SUBSCRIPTION_PLAN_BASIC: 'BASIC_PLAN',
  SUBSCRIPTION_PRICE_BASIC: 4.99,
  
  // Environment
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production'
};
