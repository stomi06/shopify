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
    successMessage: 'Gratulacje! Masz darmową dostawę :)',
    alwaysShowBar: true,
    barPosition: 'fixed',
    barTopOffset: 0,
    barHeight: 50,         // w px
    fontSize: 16,          // w px
    calculateDifference: false,  // domyślnie odznaczone
    boldText: false,       // domyślnie bez pogrubienia
    showSuccessMessage: true     // domyślnie pokazuj komunikat po osiągnięciu progu
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

      // Funkcja pomocnicza "debounce" - zapobiega zbyt częstym wywołaniom
      function debounce(func, wait) {
        let timeout;
        return function(...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => func.apply(this, args), wait);
        };
      }

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

      // Jeśli nie liczymy różnicy, wyświetl statyczny komunikat
      if (!SETTINGS.calculateDifference) {
        createBar(SETTINGS.messageTemplate);
        return;
      }

      // Funkcje do zarządzania zapisanym stanem koszyka
      const CART_STORAGE_KEY = 'freeShipping_lastCartState_' + window.location.hostname;
      
      function saveCartState(cartData) {
        try {
          const dataToSave = {
            timestamp: new Date().getTime(),
            total: cartData.items_subtotal_price / 100
          };
          localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(dataToSave));
        } catch (e) {
          console.error('Nie udało się zapisać stanu koszyka:', e);
        }
      }
      
      function getLastCartState() {
        try {
          const savedData = localStorage.getItem(CART_STORAGE_KEY);
          if (savedData) {
            return JSON.parse(savedData);
          }
        } catch (e) {
          console.error('Nie udało się odczytać stanu koszyka:', e);
        }
        return null;
      }
      
      // Funkcja generująca tekst komunikatu na podstawie kwoty - NAPRAWIONA
      function generateShippingMessage(total) {
        if (total >= SETTINGS.freeShippingThreshold) {
          // Jeśli osiągnięto próg i opcja pokazywania komunikatu jest włączona
          if (SETTINGS.showSuccessMessage) {
            return SETTINGS.successMessage || "Gratulacje! Masz darmową dostawę :)";
          } else {
            // Jeśli opcja wyłączona, nie pokazujemy paska
            return null;
          }
        } else {
          // Jeśli nie osiągnięto progu, pokaż komunikat o brakującej kwocie
          const price = SETTINGS.freeShippingThreshold - total;
          return SETTINGS.messageTemplate.replace('{price}', price.toFixed(2));
        }
      }

      // Funkcja aktualizująca pasek po pobraniu danych koszyka - NAPRAWIONA
      function updateBarWithCartData(cartData) {
        try {
          const total = cartData.items_subtotal_price / 100;
          const message = generateShippingMessage(total);
          
          let bar = document.getElementById('free-shipping-bar');
          
          // Jeśli message jest null, ukryj pasek
          if (message === null) {
            if (bar) bar.style.display = 'none';
            return;
          }
          
          // W przeciwnym razie pokaż pasek z komunikatem
          bar = createBar(message);
          bar.style.display = 'block';
          
          // Zapisz aktualny stan koszyka
          saveCartState(cartData);
        } catch (e) {
          console.error('Błąd podczas aktualizacji paska:', e);
          createBar('Darmowa dostawa od ' + SETTINGS.freeShippingThreshold + ' zł');
        }
      }

      // Licznik aktualnych żądań, aby uniknąć nakładania się aktualizacji
      let pendingRequests = 0;
      
      // Zoptymalizowana funkcja pobierająca dane koszyka
      const fetchCartData = debounce(function() {
        // Jeśli inny request jest już w trakcie, nie wysyłaj nowego
        if (pendingRequests > 0) return;
        
        pendingRequests++;
        
        // Dodanie nagłówków no-cache i timestamp aby zapobiec cache'owaniu
        fetch('/cart.js?' + new Date().getTime(), {
          headers: { 
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        })
          .then(r => r.json())
          .then(data => {
            pendingRequests--;
            updateBarWithCartData(data);
          })
          .catch(() => {
            pendingRequests--;
            createBar('Darmowa dostawa od ' + SETTINGS.freeShippingThreshold + ' zł');
          });
      }, 300);

      // Pobierz ostatni znany stan koszyka z localStorage
      const lastCartState = getLastCartState();
      
      // Utwórz pasek i wyświetl ostatni znany stan lub statyczny komunikat
      let initialMessage;
      if (lastCartState) {
        initialMessage = generateShippingMessage(lastCartState.total);
        if (initialMessage !== null) {
          createBar(initialMessage);
        }
      } else {
        createBar('Darmowa dostawa od ' + SETTINGS.freeShippingThreshold + ' zł');
      }

      // Pobierz aktualne dane koszyka w tle
      fetchCartData();

      // Reszta kodu monitorującego zmiany koszyka - bez zmian
      // ...
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
