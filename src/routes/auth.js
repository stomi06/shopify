const express = require('express');
const axios = require('axios');
const { generateNonce, saveSessionToStorage } = require('../auth/shopifyAuth');
const { SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES, HOST } = require('../config/shopify');

const router = express.Router();

/**
 * Inicjowanie procesu uwierzytelniania Shopify OAuth
 */
router.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const state = generateNonce();
  res.cookie('state', state, { httpOnly: true, secure: true, sameSite: 'lax' });

  const redirectUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&state=${state}&redirect_uri=${HOST}/auth/callback`;
  res.redirect(redirectUrl);
});

/**
 * Callback po uwierzytelnianiu OAuth
 */
router.get('/auth/callback', async (req, res) => {
  const { shop, code, state } = req.query;
  const stateCookie = req.cookies.state;

  if (!shop || !code || !state) return res.status(400).send('Missing parameters');
  if (state !== stateCookie) return res.status(403).send('Invalid state');

  try {
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    });

    const accessToken = response.data.access_token;

    // Zapisz sesję
    await saveSessionToStorage(shop, {
      shop,
      accessToken,
      isActive: () => true,
      isOnline: true
    });

    // Dodajemy script tag z paskiem
    await axios.post(`https://${shop}/admin/api/2023-04/script_tags.json`, {
      script_tag: {
        event: 'onload',
        src: `${HOST}/free-shipping-bar.js`
      }
    }, {
      headers: {
        'X-Shopify-Access-Token': accessToken,
        'Content-Type': 'application/json'
      }
    });

    res.send('Aplikacja zainstalowana i ScriptTag dodany!');
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send('Błąd podczas instalacji aplikacji');
  }
});

module.exports = router;
