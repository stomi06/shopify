import '@shopify/shopify-api/adapters/node';
import { shopifyApi, LATEST_API_VERSION, PostgreSQLSessionStorage } from "@shopify/shopify-api";
import express from "express";
import dotenv from "dotenv";
import path from "path";
import bodyParser from "body-parser";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Konfiguracja PostgreSQLSessionStorage z parametrami
const sessionStorage = new PostgreSQLSessionStorage({
  host: process.env.DB_HOST,       // Adres hosta bazy danych
  port: process.env.DB_PORT,       // Port bazy danych
  database: process.env.DB_NAME,   // Nazwa bazy danych
  user: process.env.DB_USER,       // Użytkownik bazy danych
  password: process.env.DB_PASS,   // Hasło użytkownika
});

// Konfiguracja Shopify API
const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET,
  scopes: process.env.SCOPES.split(","),
  hostName: process.env.HOST.replace(/^https?:\/\//, ""),
  isEmbeddedApp: true,
  apiVersion: LATEST_API_VERSION,
  sessionStorage, // Użycie PostgreSQLSessionStorage
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

app.get("/auth", async (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Brakuje parametru shop");

  const redirectUrl = await shopify.auth.begin({
    shop,
    callbackPath: "/auth/callback",
    isOnline: false,
    rawRequest: req,
    rawResponse: res,
  });

  return res.redirect(redirectUrl);
});

app.get("/auth/callback", async (req, res) => {
  try {
    const session = await shopify.auth.callback({
        rawRequest: req,
        rawResponse: res,
        query: req.query,
    });

    // Dodaj ScriptTag (linkujący do Twojego paska)
    const client = new shopify.clients.Rest({ session });
    await client.post({
      path: "script_tags",
      data: {
        script_tag: {
          event: "onload",
          src: `${process.env.HOST}/bar.js`,
        },
      },
      type: "application/json",
    });

    res.redirect(`/admin?shop=${session.shop}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Błąd autoryzacji");
  }
});

app.get("/admin", (req, res) => {
  res.sendFile(path.resolve("views/admin.html"));
});

app.listen(PORT, () => console.log(`✅ Serwer działa na porcie ${PORT}`));