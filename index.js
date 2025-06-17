const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
app.use(cookieParser());

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = 'write_script_tags,read_script_tags';
const HOST = process.env.HOST;  // np. https://twoja-domena.com

function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

app.get('/auth', (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send('Missing shop parameter');

  const state = generateNonce();
  console.log('Generated state:', state);
  res.cookie('state', state, { httpOnly: true, secure: true, sameSite: 'lax' });

  const redirectUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&state=${state}&redirect_uri=${HOST}/auth/callback`;

  res.redirect(redirectUrl);
});

app.get('/auth/callback', async (req, res) => {
  const { shop, code, state } = req.query;
  const stateCookie = req.cookies.state;

  console.log('State from query:', state);
console.log('State from cookie:', req.cookies.state);

  if (!shop || !code || !state) {
    return res.status(400).send('Missing parameters');
  }

  if (state !== stateCookie) {
    return res.status(403).send('Invalid state');
  }

  try {
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    });

    const accessToken = response.data.access_token;

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

app.get('/free-shipping-bar.js', (req, res) => {
  res.type('application/javascript');
  res.send(`
    (function() {
      const FREE_SHIPPING_THRESHOLD = 200;

      function getCartTotal(callback) {
        fetch('/cart.js')
          .then(r => r.json())
          .then(data => {
            callback(data.items_subtotal_price / 100);
          });
      }

      function createBar(missing) {
        let bar = document.createElement('div');
        bar.style.position = 'fixed';
        bar.style.bottom = '0';
        bar.style.left = '0';
        bar.style.width = '100%';
        bar.style.backgroundColor = '#4CAF50';
        bar.style.color = 'white';
        bar.style.textAlign = 'center';
        bar.style.padding = '10px';
        bar.style.fontSize = '16px';
        bar.style.zIndex = '9999';
        bar.textContent = 'Do darmowej dostawy brakuje: ' + missing.toFixed(2) + ' zł';
        document.body.appendChild(bar);
      }

      getCartTotal(total => {
        if (total < FREE_SHIPPING_THRESHOLD) {
          createBar(FREE_SHIPPING_THRESHOLD - total);
        }
      });
    })();
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('App listening on port ' + PORT);
});
