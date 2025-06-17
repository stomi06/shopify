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
    enabled: true,                    // czy pasek jest aktywny
    freeShippingThreshold: 200,
    barColor: '#4CAF50',
    textColor: '#FFFFFF',
    messageTemplate: 'Do darmowej dostawy brakuje: {price} zł',
    loadingMessage: 'Aktualizuję dane z koszyka',
    alwaysShowBar: true,
    barPosition: 'fixed',
    barTopOffset: 0,
    barHeight: 50,         // w px
    fontSize: 16,          // w px
    calculateDifference: false,  // domyślnie odznaczone
    boldText: false        // domyślnie bez pogrubienia
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

app.get('/free-shipping-bar.js', (req, res) => {
  res.type('application/javascript');
  res.send(`
    (function() {
      const SETTINGS = ${JSON.stringify(settings)};

      if (!SETTINGS.enabled) return;

      // Funkcja tworząca lub aktualizująca pasek
      function createBar(text) {
        let bar = document.getElementById('free-shipping-bar');
        if (!bar) {
          bar = document.createElement('div');
          bar.id = 'free-shipping-bar';
          bar.style.position = SETTINGS.barPosition;
          bar.style.top = SETTINGS.barTopOffset + 'px';
          bar.style.left = '0';
          bar.style.width = '100%';
          bar.style.height = SETTINGS.barHeight + 'px';
          bar.style.backgroundColor = SETTINGS.barColor;
          bar.style.color = SETTINGS.textColor;
          bar.style.textAlign = 'center';
          bar.style.fontSize = SETTINGS.fontSize + 'px';
          bar.style.lineHeight = SETTINGS.barHeight + 'px';
          bar.style.fontWeight = SETTINGS.boldText ? 'bold' : 'normal';
          bar.style.zIndex = '50';
          document.body.appendChild(bar);
        }
        bar.textContent = text;
        return bar;
      }

      // Natychmiast wyświetl pasek
      if (!SETTINGS.calculateDifference) {
        // Jeśli nie liczymy różnicy, wyświetl statyczny komunikat
        createBar(SETTINGS.messageTemplate);
        return;
      }

      // Pokaż placeholder natychmiast
      const bar = createBar(SETTINGS.loadingMessage);

      // Funkcja aktualizująca pasek po pobraniu danych koszyka
      function updateBarWithCartData(cartData) {
        try {
          const total = cartData.items_subtotal_price / 100;
          if (total < SETTINGS.freeShippingThreshold) {
            const price = SETTINGS.freeShippingThreshold - total;
            const message = SETTINGS.messageTemplate.replace('{price}', price.toFixed(2));
            bar.textContent = message;
          } else {
            bar.textContent = 'Gratulacje! Masz darmową dostawę :)';
          }
        } catch (e) {
          console.error('Błąd podczas aktualizacji paska:', e);
          bar.textContent = 'Darmowa dostawa od ' + SETTINGS.freeShippingThreshold + ' zł';
        }
      }

      // Funkcja pobierająca dane koszyka z serwera
      function fetchCartData() {
        const timestamp = new Date().getTime();
        fetch('/cart.js?t=' + timestamp, { 
          method: 'GET',
          headers: {
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        })
          .then(r => r.json())
          .then(data => {
            updateBarWithCartData(data);
          })
          .catch(() => {
            bar.textContent = 'Darmowa dostawa od ' + SETTINGS.freeShippingThreshold + ' zł';
          });
      }

      // Wywołaj natychmiast po załadowaniu
      fetchCartData();

      // Monitoruj zmiany w koszyku - kompleksowe podejście
      function setupCartChangeMonitoring() {
        // 1. Obserwuj zdarzenia AJAX dla śledzenia żądań związanych z koszykiem
        const originalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
          const xhr = new originalXHR();
          xhr.addEventListener('load', function() {
            if (this.responseURL && (
                this.responseURL.includes('/cart/add') || 
                this.responseURL.includes('/cart/update') || 
                this.responseURL.includes('/cart/change') ||
                this.responseURL.includes('/cart/clear') ||
                this.responseURL.includes('cart?') ||
                this.responseURL.includes('/cart.js'))) {
              // Dodaj małe opóźnienie, aby upewnić się, że dane koszyka są już zaktualizowane
              setTimeout(fetchCartData, 100);
            }
          });
          return xhr;
        };

        // 2. Nasłuchuj na wszystkie możliwe zdarzenia zmiany koszyka
        const cartEvents = [
          'cart:updated', 'cart:refresh', 'cart.requestComplete',
          'cart_update', 'ajaxCart.afterCartLoad', 'cart_updation',
          'theme:cart:change', 'cart:change', 'cart:updated',
          'product:added', 'ajax:success'
        ];

        cartEvents.forEach(event => {
          document.addEventListener(event, function() {
            setTimeout(fetchCartData, 100);
          });
        });

        // 3. Nasłuchuj na zmiany w przycisku "Dodaj do koszyka"
        document.addEventListener('click', function(event) {
          const target = event.target;
          if (target && (
              target.classList.contains('add-to-cart') ||
              target.classList.contains('add_to_cart') ||
              target.classList.contains('cart-add') ||
              target.getAttribute('name') === 'add' ||
              target.closest('form[action*="/cart/add"]')
          )) {
            // Dodaj opóźnienie, aby upewnić się, że żądanie dodania do koszyka zostało zakończone
            setTimeout(fetchCartData, 1000);
          }
        });

        // 4. Praca z fetch API (używane przez nowsze motywy)
        const originalFetch = window.fetch;
        window.fetch = function(url, options) {
          const promise = originalFetch.apply(this, arguments);
          if (url && typeof url === 'string' && (
              url.includes('/cart/add') || 
              url.includes('/cart/change') || 
              url.includes('/cart/update') ||
              url.includes('/cart/clear') ||
              url.includes('cart?') ||
              url.includes('/cart.js'))) {
            promise.then(() => {
              setTimeout(fetchCartData, 200);
            });
          }
          return promise;
        };

        // 5. jQuery AJAX (używane przez starsze motywy)
        if (window.jQuery) {
          const $ = window.jQuery;
          $(document).ajaxComplete(function(event, xhr, settings) {
            if (settings.url && (
                settings.url.includes('/cart/add') || 
                settings.url.includes('/cart/change') || 
                settings.url.includes('/cart/update') ||
                settings.url.includes('/cart/clear') ||
                settings.url.includes('cart?') ||
                settings.url.includes('/cart.js'))) {
              setTimeout(fetchCartData, 200);
            }
          });

          // jQuery zdarzenia koszyka
          $(document).on(
            'cart.requestComplete cart:refresh cart_update added.ajaxCart cart.drawn', 
            function() {
              setTimeout(fetchCartData, 200);
            }
          );
        }

        // 6. Sprawdzaj koszyk co minutę na wszelki wypadek
        setInterval(fetchCartData, 60000);
      }

      // Inicjalizuj monitorowanie zmian koszyka po załadowaniu strony
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setupCartChangeMonitoring();
      } else {
        document.addEventListener('DOMContentLoaded', setupCartChangeMonitoring);
      }
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
