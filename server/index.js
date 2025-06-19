import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
import { Pool } from "pg";
import express from "express";
import dotenv from "dotenv";
import path from "path";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";
import crypto from "crypto";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

// Implementacja CustomSessionStorage
const sessionStorage = {
  storeSession: async (session) => {
    try {
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
      await pool.query(query, values);
      return true;
    } catch (err) {
      console.error("Błąd podczas zapisywania sesji:", err);
      return false;
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
  isEmbeddedApp: true,
  apiVersion: LATEST_API_VERSION,
  sessionStorage, // Użycie CustomSessionStorage
  cookies: {
    secure: true,
    sameSite: "none",
    httpOnly: true,
    prefix: "", // Dodaj puste prefix
  }
});

app.use(cookieParser(process.env.COOKIE_SECRET)); // Dodaj sekret do cookie-parser

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
    console.log("Cookies before redirect:", req.cookies);

    const shop = req.query.shop;
    if (!shop) {
      return res.status(400).send("Missing shop parameter");
    }

    // Sprawdź, czy sklep jest prawidłowy
    const sanitizedShop = shopify.utils.sanitizeShop(shop);
    if (!sanitizedShop) {
      return res.status(400).send("Invalid shop parameter");
    }

    const redirectUrl = await shopify.auth.begin({
      shop: sanitizedShop,
      callbackPath: "/auth/callback",
      isOnline: false,
      rawRequest: req,
      rawResponse: res,
    });

    console.log("Auth rozpoczęty, przekierowanie do:", redirectUrl);
    return res.redirect(redirectUrl);
  } catch (err) {
    console.error("Błąd w /auth:", err);
    res.status(500).send("Błąd podczas inicjalizacji OAuth");
  }
});

app.get("/auth/callback", async (req, res) => {
  try {
    console.log("Cookies on callback:", req.cookies);

    const callbackResponse = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
      query: req.query,
    });

    console.log("Callback response:", callbackResponse);

    const { session } = callbackResponse;
    console.log("Session created:", session);
    
    // Redirect with session data
    return res.redirect(`/admin?shop=${session.shop}`);
  } catch (err) {
    console.error("Błąd autoryzacji:", err);
    res.status(500).send("Błąd autoryzacji");
  }
});

app.get("/admin", (req, res) => {
  res.sendFile(path.resolve("views/admin.html"));
});

app.listen(PORT, () => console.log(`✅ Serwer działa na porcie ${PORT}`));