const path = require('path');
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = 'write_script_tags,read_script_tags';
const HOST = process.env.HOST;

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

// Domyślne ustawienia paska
let settings = {
  enabled: true,
  useCart: true,
  freeShippingThreshold: 200,
  barColor: '#4CAF50',
  textColor: '#FFFFFF',
  messageTemplate: 'Do darmowej dostawy brakuje: {missing} zł',
  loadingMessage: 'Aktualizuję dane z koszyka...',
  barHeight: '50px',
  fontSize: '16px',
  topOffset: '55px',
  position: 'fixed'
};

// --- AUTH ---
app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const state = generateNonce();
  res.cookie('state', state, { httpOnly: true, secure: true, sameSite: 'lax' });

  const redirectUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&state=${state}&redirect_uri=${HOST}/auth/callback`;
  res.redirect(redirectUrl);
});

app.get('/auth/callback', async (req, res) => {
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

app.get('/free-shipping-bar.js', async (req, res) => {
  res.type('application/javascript');
  res.send(`
    (function() {
      const SETTINGS = ${JSON.stringify(settings)};

      if (!SETTINGS.enabled) return;

      function createBar(text) {
        let bar = document.createElement('div');
        bar.style.position = SETTINGS.position;
        bar.style.top = SETTINGS.topOffset || '0';
        bar.style.left = '0';
        bar.style.width = '100%';
        bar.style.backgroundColor = SETTINGS.barColor;
        bar.style.color = SETTINGS.textColor;
        bar.style.textAlign = 'center';
        bar.style.padding = '10px';
        bar.style.fontSize = SETTINGS.fontSize || '16px';
        bar.style.height = SETTINGS.barHeight || '50px';
        bar.style.lineHeight = SETTINGS.barHeight || '50px';
        bar.style.zIndex = '9999';
        bar.style.boxShadow = '0 2px 4px rgba(0,0,0,0.15)';
        bar.textContent = text;
        document.body.appendChild(bar);
      }

      if (!SETTINGS.useCart) {
        // Tryb bez koszyka
        createBar(SETTINGS.messageTemplate);
        return;
      }

      // Placeholder
      createBar(SETTINGS.loadingMessage || 'Aktualizuję dane z koszyka...');

      fetch('/cart.js')
        .then(r => r.json())
        .then(data => {
          const total = data.items_subtotal_price / 100;
          if (total < SETTINGS.freeShippingThreshold) {
            const missing = (SETTINGS.freeShippingThreshold - total).toFixed(2);
            const message = SETTINGS.messageTemplate.replace('{missing}', missing);
            document.body.lastChild.textContent = message;
          } else {
            document.body.lastChild.remove(); // Usuń placeholder
          }
        })
        .catch(() => {
          document.body.lastChild.textContent = 'Błąd pobierania koszyka';
        });
    })();
  `);
});


app.get('/settings', (req, res) => {
  res.json(settings);
});

app.post('/settings', (req, res) => {
  const {
    enabled,
    freeShippingThreshold,
    barColor,
    textColor,
    messageTemplate,
    loadingMessage,
    alwaysShowBar,
    barPosition,
    barTopOffset,
    barHeight,
    fontSize,
    calculateDifference
  } = req.body;

  if (
    typeof enabled !== 'boolean' ||
    typeof freeShippingThreshold !== 'number' ||
    typeof barColor !== 'string' ||
    typeof textColor !== 'string' ||
    typeof messageTemplate !== 'string' ||
    typeof loadingMessage !== 'string' ||
    typeof alwaysShowBar !== 'boolean' ||
    (barPosition !== 'fixed' && barPosition !== 'absolute') ||
    typeof barTopOffset !== 'number' ||
    typeof barHeight !== 'number' ||
    typeof fontSize !== 'number' ||
    typeof calculateDifference !== 'boolean'
  ) {
    return res.status(400).json({ error: 'Nieprawidłowe dane' });
  }

  settings = {
    enabled,
    freeShippingThreshold,
    barColor,
    textColor,
    messageTemplate,
    loadingMessage,
    alwaysShowBar,
    barPosition,
    barTopOffset,
    barHeight,
    fontSize,
    calculateDifference
  };

  res.json({ message: 'Ustawienia zapisane', settings });
});

// --- SERWER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('App listening on port ' + PORT);
});
