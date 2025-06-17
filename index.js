const path = require('path');
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');

const app = express();
app.use(cookieParser());

app.use(express.static(path.join(__dirname, 'public')));

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SCOPES = 'write_script_tags,read_script_tags';
const HOST = process.env.HOST; 
function generateNonce() {
  return crypto.randomBytes(16).toString('hex');
}

let settings = {
    freeShippingThreshold: 200,
    barColor: '#4CAF50',
    textColor: '#FFFFFF',
    messageTemplate: 'Do darmowej dostawy brakuje: {{missing}} zł',
    enabled: true,
    barHeight: '50px',
    fontSize: '16px',
    topOffset: '0px',
    position: 'fixed'
};



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
      const SETTINGS = ${JSON.stringify(settings)};

      if (!SETTINGS.enabled) return;

      function getCartTotal(callback) {
        fetch('/cart.js')
          .then(r => r.json())
          .then(data => {
            callback(data.items_subtotal_price / 100);
          });
      }

      function createBar(missing) {
        let bar = document.createElement('div');
        bar.style.position = SETTINGS.position;
        bar.style.top = SETTINGS.topOffset;
        bar.style.left = '0';
        bar.style.width = '100%';
        bar.style.backgroundColor = SETTINGS.barColor;
        bar.style.color = SETTINGS.textColor;
        bar.style.textAlign = 'center';
        bar.style.fontSize = SETTINGS.fontSize;
        bar.style.height = SETTINGS.barHeight;
        bar.style.lineHeight = SETTINGS.barHeight;
        bar.style.zIndex = '9999';
        bar.style.boxShadow = '0 2px 4px rgba(0,0,0,0.15)';
        bar.textContent = SETTINGS.messageTemplate.replace('{{missing}}', missing.toFixed(2));
        document.body.appendChild(bar);
      }

      getCartTotal(total => {
        if (total < SETTINGS.freeShippingThreshold) {
          createBar(SETTINGS.freeShippingThreshold - total);
        }
      });
    })();
  `);
});


app.get('/settings', (req, res) => {
  res.json(settings);
});

app.use(express.json()); // Umożliwia odczyt JSON z body

app.post('/settings', (req, res) => {
    const {
            freeShippingThreshold,
            barColor,
            textColor,
            messageTemplate,
            enabled,
            barHeight,
            fontSize,
            topOffset,
            position
        } = req.body;

        if (
            typeof freeShippingThreshold !== 'number' ||
            typeof barColor !== 'string' ||
            typeof textColor !== 'string' ||
            typeof messageTemplate !== 'string' ||
            typeof enabled !== 'boolean' ||
            typeof barHeight !== 'string' ||
            typeof fontSize !== 'string' ||
            typeof topOffset !== 'string' ||
            !['fixed', 'absolute'].includes(position)
        ) {
        return res.status(400).json({ error: 'Nieprawidłowe dane' });
        }

        settings = {
            freeShippingThreshold,
            barColor,
            textColor,
            messageTemplate,
            enabled,
            barHeight,
            fontSize,
            topOffset,
            position
    };



  res.json({ message: 'Ustawienia zapisane', settings });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('App listening on port ' + PORT);
});
