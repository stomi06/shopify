import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION } from "@shopify/shopify-api";
import { Pool } from "pg";
import express from "express";
import dotenv from "dotenv";
import path from "path";
import bodyParser from "body-parser";
import cookieParser from "cookie-parser";

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
  },
  loadSession: async (id) => {
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
  },
  deleteSession: async (id) => {
    const query = `DELETE FROM shopify_sessions WHERE id = $1`;
    await pool.query(query, [id]);
    return true;
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
});

app.use(cookieParser());

app.use((req, res, next) => {
  res.cookie("shopifyOAuth", "value", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // Ustaw na true w środowisku produkcyjnym
    sameSite: "none", // Wymagane dla Shopify
  });
  next();
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

app.get("/auth", async (req, res) => {
  console.log("Cookies before redirect:", req.cookies);

  const shop = req.query.shop;
  if (!shop) {
    return res.status(400).send("Missing shop parameter");
  }

  const redirectUrl = await shopify.auth.begin({
    shop,
    callbackPath: "/auth/callback",
    isOnline: false,
    rawRequest: req,
    rawResponse: res,
  });

  console.log("Redirecting to:", redirectUrl);
  return res.redirect(redirectUrl);
});

app.get("/auth/callback", async (req, res) => {
  console.log("Callback query params:", req.query);

  try {
    const session = await shopify.auth.callback({
      rawRequest: req,
      rawResponse: res,
    });

    console.log("Session created:", session);
    res.redirect(`/admin?shop=${session.shop}`);
  } catch (err) {
    console.error("Błąd autoryzacji:", err);
    res.status(500).send("Błąd autoryzacji");
  }
});

app.get("/admin", (req, res) => {
  res.sendFile(path.resolve("views/admin.html"));
});

app.listen(PORT, () => console.log(`✅ Serwer działa na porcie ${PORT}`));