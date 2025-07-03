import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
import { Pool } from "pg";
import express from "express";
import dotenv from "dotenv";
import path from "path";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import session from "express-session";
import fs from 'fs';

dotenv.config();

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default settings for the server
const DEFAULT_SETTINGS = {
  message: "Free delivery on orders over {amount}!",
  min_amount: 199,
  background_color: "#000000",
  text_color: "#bbbbbb", 
  position: "above-header",
  closeable: true,
  show_icon: true,
  icon_type: 'default',
  icon_size: 30,
  icon_gap: 10,
  bar_height: 40,
  width: 100,
  margin_top: 0,
  opacity: 100,
  font_size: 14,
  font_weight: 600,
  border_width: 0,
  border_color: "#cccccc",
  border_radius: 0,
  shadow_color: "#000000",
  shadow_opacity: 0,
  shadow_blur: 0,
  shadow_distance: 0,
  transparent_bg: false
};

// Default delivery icon as Base64 - embedded directly
const iconBuffer = fs.readFileSync(path.join(__dirname, 'assets', 'default-delivery-icon.svg'));
const DEFAULT_DELIVERY_ICON = `data:image/svg+xml;base64,${iconBuffer.toString('base64')}`;

const APP_URL = process.env.HOST;
const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 60000,
  max: 10,
  statement_timeout: 30000,
  query_timeout: 30000,
});

app.use('/views', express.static(path.join(__dirname, 'views')));

// Simple Express session configuration
app.use(session({
  secret: process.env.COOKIE_SECRET || 'shopify_app_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// CustomSessionStorage implementation with improved error handling
const sessionStorage = {  
  storeSession: async (session) => {
    const client = await pool.connect();
    try {
      console.log("🔄 Attempting to store session for:", session.shop);
      console.log("🔄 Session data:", JSON.stringify(session, null, 2));
      const query = `
        INSERT INTO shopify_sessions (id, shop, state, is_online, access_token, scope, expires_at, session_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (id) DO UPDATE SET
          shop = EXCLUDED.shop,
          state = EXCLUDED.state,
          is_online = EXCLUDED.is_online,
          access_token = EXCLUDED.access_token,
          scope = EXCLUDED.scope,
          expires_at = EXCLUDED.expires_at,
          session_data = EXCLUDED.session_data;
      `;
      const values = [
        session.id,
        session.shop,
        session.state,
        session.isOnline,
        session.accessToken,
        session.scope,
        session.expires ? new Date(session.expires) : null,
        JSON.stringify(session),
      ];
      console.log("🔄 SQL values:", values);
      await client.query(query, values);
      console.log("✅ Session stored successfully");
      return true;
    } catch (err) {
      console.error("❌ Error while saving session:", {
        message: err.message,
        stack: err.stack,
        code: err.code
      });
      throw err;
    } finally {
      client.release();
    }
  },
  loadSession: async (id) => {
    try {
      const query = `SELECT * FROM shopify_sessions WHERE id = $1`;
      const result = await pool.query(query, [id]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          id: row.id,
          shop: row.shop,
          state: row.state,
          isOnline: row.is_online,
          accessToken: row.access_token,
          scope: row.scope,
          expires: row.expires_at ? new Date(row.expires_at) : null,
        };
      }
      return undefined;
    } catch (err) {
      console.error("Error while loading session:", err);
      return undefined;
    }
  },
  deleteSession: async (id) => {
    try {
      const query = `DELETE FROM shopify_sessions WHERE id = $1`;
      await pool.query(query, [id]);
      return true;
    } catch (err) {
      console.error("Error while deleting session:", err);
      return false;
    }
  },
};

// Shopify API configuration
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES.split(","),
  hostName: process.env.HOST.replace(/^https?:\/\//, ""),
  isEmbeddedApp: false,
  apiVersion: LATEST_API_VERSION,
  sessionStorage,
});

app.use(cookieParser());

// Serve static files from assets folder before other middleware
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Add CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static("public"));

// Debugging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  console.log("All cookies:", req.cookies);
  console.log("Headers:", req.headers);
  next();
});

function verifyHmac(query) {
  const { hmac, ...rest } = query;
  const message = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("&");

  const generatedHmac = crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
    .update(message)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(hmac, "utf-8"), Buffer.from(generatedHmac, "utf-8"));
}

app.get("/auth", async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).send("Missing shop parameter");
    }

    console.log("Starting auth for shop:", shop);

    req.session.shop = shop;
    const state = crypto.randomBytes(16).toString('hex');
    req.session.state = state;

    console.log("Session data saved:", { shop: req.session.shop, state: req.session.state });

    req.session.save((err) => {
      if (err) {
        console.error("Error saving session:", err);
        return res.status(500).send("Error saving session");
      }

      const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${process.env.SCOPES}&redirect_uri=${process.env.HOST}/auth/callback&state=${state}`;
      console.log("Redirecting to:", authUrl);
      res.redirect(authUrl);
    });
  } catch (err) {
    console.error("Error in /auth:", err);
    res.status(500).send("Error during OAuth initialization");
  }
});

app.get("/auth/callback", async (req, res) => {
  try {
    console.log("Session in callback:", req.session);
    console.log("Query params:", req.query);
    
    const { code, hmac, state, shop } = req.query;
    
    if (!req.session) {
      console.error("No session in callback");
      return res.status(500).send("Session not found");
    }

    if (req.session.state && state !== req.session.state) {
      console.error("State mismatch:", { sessionState: req.session.state, queryState: state });
      return res.status(403).send("Request origin cannot be verified");
    }

    if (req.session.shop && shop !== req.session.shop) {
      console.error("Shop mismatch:", { sessionShop: req.session.shop, queryShop: shop });
      return res.status(403).send("Shop parameter does not match");
    }

    if (!req.session.shop) {
      req.session.shop = shop;
      console.log("Set shop from query params:", shop);
    }

    if (!verifyHmac(req.query)) {
      return res.status(400).send("HMAC verification failed");
    }

    const accessTokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code
      })
    });

    const accessTokenData = await accessTokenResponse.json();    
    console.log("Access token data:", accessTokenData);

    if (!accessTokenData.access_token) {
      console.error("No access_token received:", accessTokenData);
      return res.status(500).send("Failed to obtain access token");
    }
    const session = {
      id: `${shop}_offline`,
      shop,
      state,
      isOnline: false,
      accessToken: accessTokenData.access_token,
      scope: accessTokenData.scope,
    };
    try {
      console.log("🔄 Trying to store session:", {
        id: session.id,
        shop: session.shop,
        isOnline: session.isOnline,
        hasAccessToken: !!session.accessToken,
        scope: session.scope
      });
      await sessionStorage.storeSession(session);
      console.log("✅ Session stored in database");
    } catch (error) {
      console.error("❌ Detailed session storage error:", {
        message: error.message,
        stack: error.stack,
        session: session
      });
    }

    // Register app/uninstalled webhook
    try {
      const webhookResp = await fetch(`https://${shop}/admin/api/2023-10/webhooks.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessTokenData.access_token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          webhook: {
            topic: 'app/uninstalled',
            address: `${process.env.HOST}/webhooks/app-uninstalled`,
            format: 'json'
          }
        })
      });
      const webhookData = await webhookResp.json();
      console.log('✅ Registered webhook app/uninstalled:', webhookData);
    } catch (err) {
      console.error('❌ Error registering app/uninstalled webhook:', err);
    }

    // --- GET SHOP CURRENCY AND SAVE TO client_currencies ---
    try {
      const shopResp = await fetch(`https://${shop}/admin/api/2023-10/shop.json`, {
        headers: {
          'X-Shopify-Access-Token': accessTokenData.access_token,
          'Content-Type': 'application/json'
        }
      });
      if (shopResp.ok) {
        const shopData = await shopResp.json();
        const currency = shopData && shopData.shop && shopData.shop.currency;
        if (currency) {
          await upsertClientCurrency(shop, currency, false);
        }
      }
    } catch (err) {
      console.error('❌ Error fetching/saving shop currency:', err);
    }
    // --- END CURRENCY BLOCK ---

    // Redirect to success page
    console.log("Redirecting to success page");
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>App installed successfully</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
          .success { color: green; font-size: 24px; margin-bottom: 20px; }
          .info { color: #666; margin-bottom: 20px; }
          .button { 
            background: #5c6ac4; 
            color: white; 
            padding: 12px 24px; 
            text-decoration: none; 
            border-radius: 4px; 
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="success">The app was installed successfully!</div>
        <div class="info">Shop: ${shop}</div>
        <div class="info">You can now manage the app from the admin panel.</div>
        <a href="https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}" class="button">Open the app</a>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Authorization error:", err);
    res.status(500).send("Authorization error");
  }
});

app.get("/admin", (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send("Missing shop parameter");
  }
  res.sendFile(path.resolve("views/admin.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.resolve("views/admin.html"));
});

// API endpoint to save settings to Metafields
app.post('/api/settings', async (req, res) => {
  try {
    const { shop, settings } = req.body;
    console.log('Saving settings to metafields for shop:', shop);
    console.log('Settings:', settings);
    
    // Get access token for this shop
    const sessionResult = await pool.query('SELECT access_token FROM shopify_sessions WHERE shop = $1', [shop]);
    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Not authorized for this shop' });
    }
    const accessToken = sessionResult.rows[0].access_token;
    
    // Get existing settings (if any)
    let timer_start_time = null;
    try {
      const metafieldsResp = await fetch(`https://${shop}/admin/api/2023-10/metafields.json?namespace=free_delivery_app&key=settings`, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });
      if (metafieldsResp.ok) {
        const metafields = await metafieldsResp.json();
        if (metafields.metafields && metafields.metafields.length > 0) {
          const prevSettings = JSON.parse(metafields.metafields[0].value);
          if (prevSettings.timer_start_time) {
            timer_start_time = prevSettings.timer_start_time;
          }
        }
      }
    } catch (e) {
      // ignore, fallback to null
    }

    // If timer enabled and no timer_start_time, set to now
    if (settings.show_timer && !timer_start_time) {
      timer_start_time = new Date().toISOString();
    }
    // If timer disabled, remove timer_start_time
    if (!settings.show_timer) {
      timer_start_time = null;
    }

    // 1. Update use_customer_currency in client_currencies
    const useCustomerCurrency = settings.currency_mode === 'customer';
    await pool.query(
      `UPDATE client_currencies SET use_customer_currency = $1 WHERE shop_id = $2`,
      [useCustomerCurrency, shop]
    );

    // 2. Get shop currency from client_currencies (or update if missing)
    let shopCurrency = null;
    let currencyResult = await pool.query(
      `SELECT currency FROM client_currencies WHERE shop_id = $1`,
      [shop]
    );
    if (currencyResult.rows.length > 0) {
      shopCurrency = currencyResult.rows[0].currency;
      await pool.query(
        `UPDATE client_currencies SET use_customer_currency = $1 WHERE shop_id = $2`,
        [useCustomerCurrency, shop]
      );
    } else {
      // If no record, get currency from Shopify and insert new record
      const sessionResult = await pool.query('SELECT access_token FROM shopify_sessions WHERE shop = $1', [shop]);
      if (sessionResult.rows.length > 0) {
        const accessToken = sessionResult.rows[0].access_token;
        const shopResp = await fetch(`https://${shop}/admin/api/2023-10/shop.json`, {
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json'
          }
        });
        if (shopResp.ok) {
          const shopData = await shopResp.json();
          shopCurrency = shopData && shopData.shop && shopData.shop.currency;
          if (shopCurrency) {
            await upsertClientCurrency(shop, shopCurrency, useCustomerCurrency);
          }
        }
      }
    }

    // 2. If use_customer_currency, get rates and add to metafields
    let exchangeRates = null;
    if (useCustomerCurrency && shopCurrency) {
      const ratesResult = await pool.query(
        `SELECT target_currency, rate FROM exchange_rates WHERE base_currency = $1`,
        [shopCurrency]
      );
      exchangeRates = {};
      for (const row of ratesResult.rows) {
        exchangeRates[row.target_currency] = row.rate;
      }
    }

    const settingsData = {
      ...settings,
      timer_start_time,
      app_url: APP_URL,
      use_customer_currency: useCustomerCurrency,
      shop_currency: shopCurrency,
      exchange_rates: exchangeRates || null
    };

    const metafieldData = {
      metafield: {
        namespace: "free_delivery_app",
        key: "settings",
        value: JSON.stringify(settingsData),
        type: "json"
      }
    };
    
    const response = await fetch(`https://${shop}/admin/api/2023-10/metafields.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metafieldData)
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Shopify API error:', error);
      return res.status(500).json({ error: 'Error saving to Shopify' });
    }
    
    const result = await response.json();
    console.log('✅ Settings saved to metafields:', result);
    
    res.json({ success: true, metafield: result });
  } catch (err) {
    console.error('❌ Error saving settings:', err.message);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

// API endpoint to get settings from Metafields
app.get('/api/settings/:shop', async (req, res) => {
  try {
    const { shop } = req.params;
    console.log('Getting settings from metafields for shop:', shop);
    
    // Get access token for this shop
    const sessionResult = await pool.query('SELECT access_token FROM shopify_sessions WHERE shop = $1', [shop]);
    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Not authorized for this shop' });
    }
    const accessToken = sessionResult.rows[0].access_token;
    
    // Get metafields from Shopify
    const response = await fetch(`https://${shop}/admin/api/2023-10/metafields.json?namespace=free_delivery_app&key=settings`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      console.log('⚠️ No metafields, returning default settings');
      return res.json({
        ...DEFAULT_SETTINGS,
        app_url: APP_URL,
        icon_image: DEFAULT_DELIVERY_ICON
      });
    }
    
    const metafields = await response.json();
    
    if (metafields.metafields && metafields.metafields.length > 0) {
      const settings = JSON.parse(metafields.metafields[0].value);
      if (!settings.icon_image) {
        settings.icon_image = DEFAULT_DELIVERY_ICON;
      }
      console.log('✅ Found settings in metafields:', settings);
      res.json(settings);
    } else {
      console.log('⚠️ Empty metafield, returning default');
      res.json({
        ...DEFAULT_SETTINGS,
        app_url: APP_URL,
        icon_image: DEFAULT_DELIVERY_ICON
      });
    }
  } catch (err) {
    console.error('❌ Error getting settings:', err.message);
    res.status(500).json({ error: 'Server error: ' + err.message });  
  }
});

// Remove or fix endpoint for default icon (no PNG needed!)
// You can remove it or keep as SVG if you want to use it:
app.get('/default-icon', (req, res) => {
  res.sendFile(path.join(__dirname, 'assets', 'default-delivery-icon.svg'));
});

// Endpoint to get shop currency
app.get('/api/shop-currency', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    // Get access token for this shop
    const sessionResult = await pool.query('SELECT access_token FROM shopify_sessions WHERE shop = $1', [shop]);
    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Not authorized for this shop' });
    }
    const accessToken = sessionResult.rows[0].access_token;

    // Get shop data from Shopify API
    const response = await fetch(`https://${shop}/admin/api/2023-10/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'Error fetching shop data from Shopify' });
    }

    const data = await response.json();
    const currency = data && data.shop && data.shop.currency ? data.shop.currency : null;
    if (!currency) {
      return res.status(404).json({ error: 'Shop currency not found' });
    }

    res.json({ currency });
  } catch (err) {
    console.error('❌ Error getting shop currency:', err.message);
    res.status(500).json({ error: 'Server error: ' + err.message });
  }
});

app.post('/webhooks/app-uninstalled', bodyParser.json(), async (req, res) => {
  console.log('🔔 Received webhook app-uninstalled!');
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  const shop = req.headers['x-shopify-shop-domain'];
  if (!shop) {
    console.error('Missing x-shopify-shop-domain header');
    return res.status(400).send('Missing shop domain');
  }
  try {
    await pool.query('DELETE FROM shopify_sessions WHERE shop = $1', [shop]);
    console.log(`✅ Deleted session data for shop: ${shop}`);
    await pool.query('DELETE FROM client_currencies WHERE shop_id = $1', [shop]);
    console.log(`✅ Deleted shop currency from client_currencies: ${shop}`);
    res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Error deleting session:', err);
    res.status(500).send('Error');
  }
});

// Function to verify Shopify webhook HMAC
function verifyShopifyWebhook(req, res, buf) {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  if (!hmacHeader) return false;
  const generatedHmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(buf)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hmacHeader, 'utf-8'), Buffer.from(generatedHmac, 'utf-8'));
}

// Middleware to verify HMAC for webhooks
function shopifyWebhookMiddleware(req, res, next) {
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    if (!verifyShopifyWebhook(req, res, data)) {
      return res.status(401).send('Unauthorized');
    }
    req.rawBody = data;
    next();
  });
}

// customers/data_request webhook (you do not store customer data)
app.post('/webhooks/customers/data_request', shopifyWebhookMiddleware, (req, res) => {
  console.log('🔔 customers/data_request webhook:', req.body);
  res.status(200).send('OK');
});

// customers/redact webhook (you do not store customer data)
app.post('/webhooks/customers/redact', shopifyWebhookMiddleware, (req, res) => {
  console.log('🔔 customers/redact webhook:', req.body);
  res.status(200).send('OK');
});

// shop/redact webhook (delete shop data from database)
app.post('/webhooks/shop/redact', shopifyWebhookMiddleware, async (req, res) => {
  const { shop_domain } = req.body;
  console.log('🔔 shop/redact webhook for shop:', shop_domain);
  if (shop_domain) {
    await pool.query('DELETE FROM shopify_sessions WHERE shop = $1', [shop_domain]);
    // If you have other tables with shop data, delete them here
  }
  res.status(200).send('OK');
});

// Function to insert/update shop currency and use_customer_currency
async function upsertClientCurrency(shop, currency, useCustomerCurrency = false) {
  const selectQuery = `SELECT id, currency, use_customer_currency FROM client_currencies WHERE shop_id = $1`;
  const result = await pool.query(selectQuery, [shop]);
  if (result.rows.length === 0) {
    await pool.query(
      `INSERT INTO client_currencies (shop_id, currency, use_customer_currency, created_at) VALUES ($1, $2, $3, NOW())`,
      [shop, currency, useCustomerCurrency]
    );
    console.log(`✅ Added currency ${currency} (use_customer_currency=${useCustomerCurrency}) for shop ${shop} to client_currencies`);
  } else {
    if (
      result.rows[0].currency !== currency ||
      result.rows[0].use_customer_currency !== useCustomerCurrency
    ) {
      await pool.query(
        `UPDATE client_currencies SET currency = $2, use_customer_currency = $3, created_at = NOW() WHERE shop_id = $1`,
        [shop, currency, useCustomerCurrency]
      );
      console.log(`✅ Updated currency to ${currency} (use_customer_currency=${useCustomerCurrency}) for shop ${shop} in client_currencies`);
    } else {
      console.log(`ℹ️ Shop ${shop} currency already up to date (${currency}, use_customer_currency=${useCustomerCurrency})`);
    }
  }
}

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));