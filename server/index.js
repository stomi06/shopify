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

dotenv.config();
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
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Implementacja CustomSessionStorage z lepszą obsługą błędów
const sessionStorage = {  storeSession: async (session) => {
    try {
      console.log("Attempting to store session for:", session.shop);
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
      
      // Użyj krótkiego timeout'u dla zapytania
      const client = await pool.connect();
      try {
        await client.query(query, values);
        return true;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error("Błąd podczas zapisywania sesji:", err.message);
      throw err; // Pozwól obsłużyć błąd wyżej
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

// Dodaj CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
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
      await sessionStorage.storeSession(session);
      console.log("✅ Sesja zapisana w bazie danych");
    } catch (error) {
      console.warn("⚠️ Nie udało się zapisać sesji w bazie, ale aplikacja działa:", error.message);
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

// API endpoint do zapisywania ustawień
app.post('/api/settings', async (req, res) => {
  const client = await pool.connect();
  try {
    const { shop, settings } = req.body;
    console.log('Zapisuję ustawienia dla sklepu:', shop);
    console.log('Ustawienia:', settings);
    
    const query = `
      INSERT INTO app_settings (shop, settings) 
      VALUES ($1, $2)
      ON CONFLICT (shop) DO UPDATE SET 
        settings = EXCLUDED.settings,
        updated_at = NOW()
    `;
    
    await client.query(query, [shop, JSON.stringify(settings)]);
    console.log('✅ Ustawienia zapisane pomyślnie');
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Błąd zapisywania ustawień:', err.message);
    res.status(500).json({ error: 'Błąd serwera: ' + err.message });
  } finally {
    client.release();
  }
});

// API endpoint do pobierania ustawień
app.get('/api/settings/:shop', async (req, res) => {
  const client = await pool.connect();
  try {
    const { shop } = req.params;
    console.log('Pobieram ustawienia dla sklepu:', shop);
    
    const result = await client.query('SELECT settings FROM app_settings WHERE shop = $1', [shop]);
    
    if (result.rows.length > 0) {
      console.log('✅ Znaleziono ustawienia');
      res.json(result.rows[0].settings);
    } else {
      console.log('⚠️ Brak ustawień, zwracam domyślne');
      // Domyślne ustawienia
      res.json({
        message: "🚚 Darmowa dostawa przy zamówieniu powyżej {amount} zł!",
        min_amount: 199,
        background_color: "#4CAF50",
        text_color: "#FFFFFF",
        position: "top",
        closeable: true
      });
    }
  } catch (err) {
    console.error('❌ Błąd pobierania ustawień:', err.message);
    res.status(500).json({ error: 'Błąd serwera: ' + err.message });
  } finally {
    client.release();
  }
});

// Endpoint dla rozszerzenia do pobierania ustawień
app.get('/api/delivery-bar/:shop', async (req, res) => {
  const client = await pool.connect();
  try {
    const { shop } = req.params;
    console.log(`Pobieranie ustawień dla sklepu: ${shop}`);
    
    const result = await client.query('SELECT settings FROM app_settings WHERE shop = $1', [shop]);
    
    if (result.rows.length > 0) {
      const settings = result.rows[0].settings;
      console.log(`✅ Znalezione ustawienia:`, settings);
      res.json(settings);
    } else {
      const defaultSettings = {
        message: "🚚 Darmowa dostawa przy zamówieniu powyżej {amount}!",
        min_amount: 199,
        background_color: "#4CAF50",
        text_color: "#FFFFFF",
        position: "top",
        closeable: true
      };
      console.log(`⚠️ Brak ustawień, zwracam domyślne`);
      res.json(defaultSettings);
    }
  } catch (err) {
    console.error('❌ Błąd pobierania ustawień dla rozszerzenia:', err.message);
    res.status(500).json({ 
      error: 'Błąd serwera',
      message: "🚚 Darmowa dostawa przy zamówieniu powyżej 199 zł!",
      min_amount: 199,
      background_color: "#4CAF50", 
      text_color: "#FFFFFF",
      position: "top",
      closeable: true
    });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => console.log(`✅ Serwer działa na porcie ${PORT}`));