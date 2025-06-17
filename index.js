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

      // Natychmiast wyświetl pasek
      if (!SETTINGS.calculateDifference) {
        // Jeśli nie liczymy różnicy, wyświetl statyczny komunikat
        createBar(SETTINGS.messageTemplate);
        return;
      }

      // Klucz do localStorage dla zapisania stanu koszyka
      const CART_STORAGE_KEY = 'free_shipping_bar_cart_data_' + window.location.hostname;
      
      // Próba pobrania danych koszyka z localStorage
      function getSavedCartData() {
        try {
          const saved = localStorage.getItem(CART_STORAGE_KEY);
          if (saved) {
            const cartData = JSON.parse(saved);
            const timestamp = cartData._timestamp || 0;
            // Sprawdź czy dane nie są starsze niż 24 godziny
            if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
              return cartData;
            }
          }
        } catch (e) {
          console.log('Błąd przy odczycie zapisanych danych koszyka:', e);
        }
        return null;
      }
      
      // Zapisz dane koszyka do localStorage
      function saveCartData(cartData) {
        try {
          // Dodaj timestamp do danych
          cartData._timestamp = Date.now();
          localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartData));
        } catch (e) {
          console.log('Błąd przy zapisie danych koszyka:', e);
        }
      }
      
      // Funkcja generująca tekst paska
      function generateBarText(cartData) {
        try {
          const total = cartData.items_subtotal_price / 100;
          if (total < SETTINGS.freeShippingThreshold) {
            const price = SETTINGS.freeShippingThreshold - total;
            return SETTINGS.messageTemplate.replace('{price}', price.toFixed(2));
          } else {
            return 'Gratulacje! Masz darmową dostawę :)';
          }
        } catch (e) {
          return 'Darmowa dostawa od ' + SETTINGS.freeShippingThreshold + ' zł';
        }
      }

      // Pokaż pasek z zapisanymi lub domyślnymi danymi
      const savedCartData = getSavedCartData();
      const bar = createBar(
        savedCartData ? generateBarText(savedCartData) : 'Darmowa dostawa od ' + SETTINGS.freeShippingThreshold + ' zł'
      );

      // Licznik aktualnych żądań, aby uniknąć nakładania się aktualizacji
      let pendingRequests = 0;
      
      // Funkcja aktualizująca pasek po pobraniu danych koszyka
      function updateBarWithCartData(cartData) {
        // Zapisz dane koszyka do localStorage
        saveCartData(cartData);
        // Aktualizuj tekst paska
        bar.textContent = generateBarText(cartData);
      }

      // Zoptymalizowana funkcja pobierająca dane koszyka
      const fetchCartData = debounce(function() {
        // Jeśli inny request jest już w trakcie, nie wysyłaj nowego
        if (pendingRequests > 0) return;
        
        pendingRequests++;
        fetch('/cart.js?' + new Date().getTime())
          .then(r => r.json())
          .then(data => {
            pendingRequests--;
            updateBarWithCartData(data);
          })
          .catch(() => {
            pendingRequests--;
          });
      }, 300); // Czekaj 300ms przed wykonaniem żądania

      // Wywołaj pobranie aktualnych danych, ale bez pokazywania komunikatu ładowania
      fetchCartData();

      // Lekki system monitorowania zmian koszyka
      function setupLightCartMonitoring() {
        // 1. Nasłuchuj na najczęstsze zdarzenia koszyka
        const cartEvents = ['cart:updated', 'cart:refresh', 'cart.requestComplete'];
        cartEvents.forEach(event => {
          document.addEventListener(event, fetchCartData);
        });

        // 2. Delegacja zdarzeń dla przycisków dodawania do koszyka
        document.addEventListener('click', function(event) {
          // Sprawdź czy kliknięty element lub jego rodzic jest przyciskiem dodawania do koszyka
          const button = event.target.closest('[name="add"], .add-to-cart, .add_to_cart, form[action*="/cart/add"] button');
          if (button) {
            // Daj trochę czasu na przetworzenie żądania
            setTimeout(fetchCartData, 1000);
          }
        }, { passive: true });

        // 3. Nasłuchuj na zdarzenia jQuery jeśli dostępne (tylko najbardziej powszechne)
        if (window.jQuery) {
          window.jQuery(document).on('cart.requestComplete', fetchCartData);
        }

        // 4. Sprawdzaj koszyk po załadowaniu strony i po każdej zmianie URL (zmiana strony w SPA)
        window.addEventListener('popstate', fetchCartData);
      }

      // Inicjalizuj lekkie monitorowanie
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setupLightCartMonitoring();
      } else {
        document.addEventListener('DOMContentLoaded', setupLightCartMonitoring);
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
