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

// Update default settings in server
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

// Prosta konfiguracja sesji Express
app.use(session({
  secret: process.env.COOKIE_SECRET || 'shopify_app_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false,
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000 // 24 godziny
  }
}));

// Implementacja CustomSessionStorage z lepszą obsługą błędów
const sessionStorage = {  storeSession: async (session) => {
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
      console.error("❌ Błąd podczas zapisywania sesji:", {
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
      console.error("Błąd podczas ładowania sesji:", err);
      return undefined;
    }
  },
  deleteSession: async (id) => {
    try {
      const query = `DELETE FROM shopify_sessions WHERE id = $1`;
      await pool.query(query, [id]);
      return true;
    } catch (err) {
      console.error("Błąd podczas usuwania sesji:", err);
      return false;
    }
  },
};

// Konfiguracja Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES.split(","),
  hostName: process.env.HOST.replace(/^https?:\/\//, ""),
  isEmbeddedApp: false, // Zmień na false aby uniknąć problemów z iframe
  apiVersion: LATEST_API_VERSION,
  sessionStorage, // Użycie CustomSessionStorage
});

app.use(cookieParser()); // Usuń sekret z cookie-parser

// Serwuj pliki statyczne z folderu assets PRZED innymi middleware
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Dodaj CORS middleware
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

    // Zapisz informacje o sklepie w sesji
    req.session.shop = shop;

    // Wygeneruj stan dla OAuth i zapisz go w sesji
    const state = crypto.randomBytes(16).toString('hex');
    req.session.state = state;

    console.log("Session data saved:", { shop: req.session.shop, state: req.session.state });

    // Zapisz sesję przed przekierowaniem
    req.session.save((err) => {
      if (err) {
        console.error("Error saving session:", err);
        return res.status(500).send("Error saving session");
      }

      // Przekieruj do Shopify OAuth
      const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${process.env.SHOPIFY_API_KEY}&scope=${process.env.SCOPES}&redirect_uri=${process.env.HOST}/auth/callback&state=${state}`;
      
      console.log("Przekierowuję do:", authUrl);
      res.redirect(authUrl);
    });
  } catch (err) {
    console.error("Błąd w /auth:", err);
    res.status(500).send("Błąd podczas inicjalizacji OAuth");
  }
});

app.get("/auth/callback", async (req, res) => {
  try {
    console.log("Session w callback:", req.session);
    console.log("Query params:", req.query);
    
    const { code, hmac, state, shop } = req.query;
    
    // Sprawdź czy sesja istnieje
    if (!req.session) {
      console.error("Brak sesji w callback");
      return res.status(500).send("Session not found");
    }

    // Sprawdź czy stan zgadza się z tym z sesji (jeśli istnieje)
    if (req.session.state && state !== req.session.state) {
      console.error("State mismatch:", { sessionState: req.session.state, queryState: state });
      return res.status(403).send("Request origin cannot be verified");
    }

    // Sprawdź czy sklep zgadza się z tym z sesji (jeśli istnieje)
    if (req.session.shop && shop !== req.session.shop) {
      console.error("Shop mismatch:", { sessionShop: req.session.shop, queryShop: shop });
      return res.status(403).send("Shop parameter does not match");
    }

    // Jeśli sesja nie ma danych, użyj danych z query (fallback)
    if (!req.session.shop) {
      req.session.shop = shop;
      console.log("Ustawiono shop z query params:", shop);
    }

    // Weryfikuj HMAC
    if (!verifyHmac(req.query)) {
      return res.status(400).send("HMAC verification failed");
    }

    // Wymień kod na token dostępu
    const accessTokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code
      })
    });

    const accessTokenData = await accessTokenResponse.json();    console.log("Access token data:", accessTokenData);

    // Sprawdź czy otrzymaliśmy prawidłowy token
    if (!accessTokenData.access_token) {
      console.error("Nie otrzymano access_token:", accessTokenData);
      return res.status(500).send("Failed to obtain access token");
    }    // Zapisz token w bazie danych (opcjonalnie)
    const session = {
      id: `${shop}_offline`,
      shop,
      state,
      isOnline: false,
      accessToken: accessTokenData.access_token,
      scope: accessTokenData.scope,
    };    // Spróbuj zapisać sesję, ale nie przerywaj jeśli się nie uda
    try {
      console.log("🔄 Próbuję zapisać sesję:", {
        id: session.id,
        shop: session.shop,
        isOnline: session.isOnline,
        hasAccessToken: !!session.accessToken,
        scope: session.scope
      });
      await sessionStorage.storeSession(session);
      console.log("✅ Sesja zapisana w bazie danych");
    } catch (error) {
      console.error("❌ Szczegółowy błąd zapisywania sesji:", {
        message: error.message,
        stack: error.stack,
        session: session
      });
    }

    // Przekieruj do strony sukcesu
    console.log("Przekierowuję do strony sukcesu");
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Aplikacja zainstalowana pomyślnie</title>
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
        <div class="success">✅ Aplikacja została zainstalowana pomyślnie!</div>
        <div class="info">Sklep: ${shop}</div>
        <div class="info">Możesz teraz zarządzać aplikacją przez panel administracyjny.</div>
        <a href="https://${shop}/admin/apps/${process.env.SHOPIFY_API_KEY}" class="button">Otwórz aplikację</a>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Błąd autoryzacji:", err);
    res.status(500).send("Błąd autoryzacji");
  }
});

app.get("/admin", (req, res) => {
  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send("Missing shop parameter");
  }
  
  // Wyświetl panel aplikacji
  res.sendFile(path.resolve("views/admin.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.resolve("views/admin.html"));
});

// API endpoint do zapisywania ustawień do Metafields
app.post('/api/settings', async (req, res) => {
  try {
    const { shop, settings } = req.body;
    console.log('Zapisuję ustawienia do metafields dla sklepu:', shop);
    console.log('Ustawienia:', settings);
    
    // Pobierz access token dla tego sklepu
    const sessionResult = await pool.query('SELECT access_token FROM shopify_sessions WHERE shop = $1', [shop]);
    
    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Brak autoryzacji dla tego sklepu' });
    }
    
    const accessToken = sessionResult.rows[0].access_token;
    
    // Pobierz istniejące ustawienia (jeśli są)
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

    // Jeśli timer włączony i nie ma timer_start_time, ustaw na teraz
    if (settings.show_timer && !timer_start_time) {
      timer_start_time = new Date().toISOString();
    }
    // Jeśli timer wyłączony, usuń timer_start_time
    if (!settings.show_timer) {
      timer_start_time = null;
    }

    const settingsData = {
      ...settings,
      timer_start_time, // zawsze nadpisz pole
      app_url: APP_URL
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
      console.error('Błąd Shopify API:', error);
      return res.status(500).json({ error: 'Błąd zapisywania do Shopify' });
    }
    
    const result = await response.json();
    console.log('✅ Ustawienia zapisane do metafields:', result);
    
    res.json({ success: true, metafield: result });
  } catch (err) {
    console.error('❌ Błąd zapisywania ustawień:', err.message);
    res.status(500).json({ error: 'Błąd serwera: ' + err.message });
  }
});

// API endpoint do pobierania ustawień z Metafields
app.get('/api/settings/:shop', async (req, res) => {
  try {
    const { shop } = req.params;
    console.log('Pobieram ustawienia z metafields dla sklepu:', shop);
    
    // Pobierz access token dla tego sklepu
    const sessionResult = await pool.query('SELECT access_token FROM shopify_sessions WHERE shop = $1', [shop]);
    
    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Brak autoryzacji dla tego sklepu' });
    }
    
    const accessToken = sessionResult.rows[0].access_token;
    
    // Pobierz metafields z Shopify
    const response = await fetch(`https://${shop}/admin/api/2023-10/metafields.json?namespace=free_delivery_app&key=settings`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });
      if (!response.ok) {
      console.log('⚠️ Brak metafields, zwracam domyślne ustawienia');
      return res.json({
        ...DEFAULT_SETTINGS,
        app_url: APP_URL,
        icon_image: DEFAULT_DELIVERY_ICON
      });
    }
    
    const metafields = await response.json();
    
    if (metafields.metafields && metafields.metafields.length > 0) {
      const settings = JSON.parse(metafields.metafields[0].value);
      // ZAWSZE dodaj icon_image do settings jeśli go nie ma
      if (!settings.icon_image) {
        settings.icon_image = DEFAULT_DELIVERY_ICON;
      }
      console.log('✅ Znaleziono ustawienia w metafields:', settings);
      res.json(settings);
    } else {
      console.log('⚠️ Pusty metafield, zwracam domyślne');
      res.json({
        ...DEFAULT_SETTINGS,
        app_url: APP_URL,
        icon_image: DEFAULT_DELIVERY_ICON
      });
    }
  } catch (err) {
    console.error('❌ Błąd pobierania ustawień:', err.message);
    res.status(500).json({ error: 'Błąd serwera: ' + err.message });  
  }
});

// Usuń lub popraw endpoint dla domyślnej ikony (niepotrzebny PNG!)
// Możesz go całkiem usunąć lub poprawić na SVG jeśli chcesz go używać:
app.get('/default-icon', (req, res) => {
  res.sendFile(path.join(__dirname, 'assets', 'default-delivery-icon.svg'));
});

// Endpoint do pobierania waluty sklepu
app.get('/api/shop-currency', async (req, res) => {
  try {
    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    // Pobierz access token dla tego sklepu
    const sessionResult = await pool.query('SELECT access_token FROM shopify_sessions WHERE shop = $1', [shop]);
    if (sessionResult.rows.length === 0) {
      return res.status(401).json({ error: 'Brak autoryzacji dla tego sklepu' });
    }
    const accessToken = sessionResult.rows[0].access_token;

    // Pobierz dane sklepu z Shopify API
    const response = await fetch(`https://${shop}/admin/api/2023-10/shop.json`, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'Błąd pobierania danych sklepu z Shopify' });
    }

    const data = await response.json();
    const currency = data && data.shop && data.shop.currency ? data.shop.currency : null;
    if (!currency) {
      return res.status(404).json({ error: 'Nie znaleziono waluty sklepu' });
    }

    res.json({ currency });
  } catch (err) {
    console.error('❌ Błąd pobierania waluty sklepu:', err.message);
    res.status(500).json({ error: 'Błąd serwera: ' + err.message });
  }
});

app.post('/webhooks/app-uninstalled', bodyParser.json(), async (req, res) => {
  console.log('🔔 Otrzymano webhook app-uninstalled!');
  console.log('Nagłówki:', req.headers);
  console.log('Body:', req.body);
  // Shopify przesyła domenę sklepu w nagłówku
  const shop = req.headers['x-shopify-shop-domain'];
  if (!shop) {
    console.error('Brak nagłówka x-shopify-shop-domain');
    return res.status(400).send('Missing shop domain');
  }
  try {
    // Usuń sesję sklepu
    await pool.query('DELETE FROM shopify_sessions WHERE shop = $1', [shop]);
    console.log(`✅ Usunięto dane sesji dla sklepu: ${shop}`);
    // (opcjonalnie) Usuń inne dane powiązane z tym sklepem, jeśli trzymasz je w innych tabelach
    res.status(200).send('OK');
  } catch (err) {
    console.error('❌ Błąd usuwania sesji:', err);
    res.status(500).send('Error');
  }
});

// Funkcja do weryfikacji HMAC webhooka Shopify
function verifyShopifyWebhook(req, res, buf) {
  const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
  if (!hmacHeader) return false;
  const generatedHmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(buf)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hmacHeader, 'utf-8'), Buffer.from(generatedHmac, 'utf-8'));
}

// Middleware do weryfikacji HMAC dla webhooków
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

// customers/data_request webhook (nie przechowujesz danych klientów)
app.post('/webhooks/customers/data_request', shopifyWebhookMiddleware, (req, res) => {
  console.log('🔔 customers/data_request webhook:', req.body);
  res.status(200).send('OK');
});

// customers/redact webhook (nie przechowujesz danych klientów)
app.post('/webhooks/customers/redact', shopifyWebhookMiddleware, (req, res) => {
  console.log('🔔 customers/redact webhook:', req.body);
  res.status(200).send('OK');
});

// shop/redact webhook (usuń dane sklepu z bazy)
app.post('/webhooks/shop/redact', shopifyWebhookMiddleware, async (req, res) => {
  const { shop_domain } = req.body;
  console.log('🔔 shop/redact webhook dla sklepu:', shop_domain);
  if (shop_domain) {
    await pool.query('DELETE FROM shopify_sessions WHERE shop = $1', [shop_domain]);
    // Jeśli masz inne tabele z danymi sklepu, usuń je tutaj
  }
  res.status(200).send('OK');
});

app.listen(PORT, () => console.log(`✅ Serwer działa na porcie ${PORT}`));