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
    messageTemplate: 'Darmowa dostawa od 200zł',
    loadingMessage: 'Aktualizuję dane z koszyka',
    successMessage: 'Gratulacje! Masz darmową dostawę :)',
    alwaysShowBar: true,
    barPosition: 'fixed',
    barTopOffset: 0,
    barHeight: 50,         // w px
    fontSize: 16,          // w px
    calculateDifference: false,  // domyślnie odznaczone
    boldText: false,       // domyślnie bez pogrubienia
    showSuccessMessage: true,    // domyślnie pokazuj komunikat po osiągnięciu progu
    // Nowe ustawienia dla ramki
    showBorder: false,     // domyślnie bez ramki
    borderWidth: 1,        // w px
    borderColor: '#000000',
    borderRadius: 0,       // w px
    // Nowe ustawienia dla cienia
    showShadow: false,     // domyślnie bez cienia
    shadowColor: 'rgba(0, 0, 0, 0.3)',
    shadowBlur: 5,         // w px
    shadowOffsetY: 2       // w px
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
      console.log('Załadowane ustawienia paska:', SETTINGS);

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
          bar.style.zIndex = '1';
          
          // Dodanie stylów dla ramki
          if (SETTINGS.showBorder) {
            bar.style.borderWidth = SETTINGS.borderWidth + 'px';
            bar.style.borderStyle = 'solid';
            bar.style.borderColor = SETTINGS.borderColor;
            bar.style.borderRadius = SETTINGS.borderRadius + 'px';
            // Usuń górną ramkę, jeśli pasek jest na górze strony
            if (SETTINGS.barPosition === 'fixed' && SETTINGS.barTopOffset === 0) {
              bar.style.borderTop = 'none';
            }
          }
          
          // Dodanie stylów dla cienia
          if (SETTINGS.showShadow) {
            bar.style.boxShadow = \`0 \${SETTINGS.shadowOffsetY}px \${SETTINGS.shadowBlur}px \${SETTINGS.shadowColor}\`;
          }
          
          document.body.appendChild(bar);
        } else {
          // Aktualizacja stylów istniejącego paska
          bar.style.backgroundColor = SETTINGS.barColor;
          bar.style.color = SETTINGS.textColor;
          bar.style.fontSize = SETTINGS.fontSize + 'px';
          bar.style.height = SETTINGS.barHeight + 'px';
          bar.style.lineHeight = SETTINGS.barHeight + 'px';
          bar.style.fontWeight = SETTINGS.boldText ? 'bold' : 'normal';
          
          // Aktualizacja ramki
          if (SETTINGS.showBorder) {
            bar.style.borderWidth = SETTINGS.borderWidth + 'px';
            bar.style.borderStyle = 'solid';
            bar.style.borderColor = SETTINGS.borderColor;
            bar.style.borderRadius = SETTINGS.borderRadius + 'px';
            if (SETTINGS.barPosition === 'fixed' && SETTINGS.barTopOffset === 0) {
              bar.style.borderTop = 'none';
            }
          } else {
            bar.style.border = 'none';
          }
          
          // Aktualizacja cienia
          if (SETTINGS.showShadow) {
            bar.style.boxShadow = \`0 \${SETTINGS.shadowOffsetY}px \${SETTINGS.shadowBlur}px \${SETTINGS.shadowColor}\`;
          } else {
            bar.style.boxShadow = 'none';
          }
        }
        
        bar.textContent = text;
        bar.style.display = 'block';
        return bar;
      }

      // Funkcja ukrywająca pasek
      function hideBar() {
        const bar = document.getElementById('free-shipping-bar');
        if (bar) {
          bar.style.display = 'none';
        }
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
      
      // Funkcja generująca tekst komunikatu na podstawie kwoty
      function generateShippingMessage(total) {
        if (total >= SETTINGS.freeShippingThreshold) {
          // Jeśli osiągnięto próg
          if (SETTINGS.showSuccessMessage) {
            return SETTINGS.successMessage || "Gratulacje! Masz darmową dostawę :)";
          } else {
            return null; // Ukryj pasek
          }
        } else {
          // Nie osiągnięto progu - zawsze pokazuj komunikat o brakującej kwocie
          const price = SETTINGS.freeShippingThreshold - total;
          return SETTINGS.messageTemplate.replace('{price}', price.toFixed(2));
        }
      }

      // Funkcja aktualizująca pasek po pobraniu danych koszyka
      function updateBarWithCartData(cartData) {
        try {
          const total = cartData.items_subtotal_price / 100;
          const message = generateShippingMessage(total);
          
          console.log('Aktualizacja paska - kwota:', total, 'próg:', SETTINGS.freeShippingThreshold, 'komunikat:', message);
          
          if (message === null) {
            hideBar();
          } else {
            createBar(message);
          }
          
          // Zapisz aktualny stan koszyka
          saveCartState(cartData);
        } catch (e) {
          console.error('Błąd podczas aktualizacji paska:', e);
          createBar('Darmowa dostawa od ' + SETTINGS.freeShippingThreshold + ' zł');
        }
      }

      // Funkcja pobierająca dane koszyka z serwera
      function fetchCartData() {
        console.log('Pobieranie danych koszyka...');
        
        const timestamp = new Date().getTime();
        fetch('/cart.js?' + timestamp, {
          method: 'GET',
          headers: { 
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          },
          cache: 'no-store'
        })
          .then(r => {
            console.log('Odpowiedź z serwera:', r.status);
            return r.json();
          })
          .then(data => {
            console.log('Dane koszyka:', data);
            updateBarWithCartData(data);
          })
          .catch(error => {
            console.error('Błąd pobierania danych koszyka:', error);
            createBar('Darmowa dostawa od ' + SETTINGS.freeShippingThreshold + ' zł');
          });
      }

      // Pobierz ostatni znany stan koszyka z localStorage
      const lastCartState = getLastCartState();
      
      // Utwórz pasek i wyświetl ostatni znany stan
      if (lastCartState) {
        const initialMessage = generateShippingMessage(lastCartState.total);
        if (initialMessage !== null) {
          createBar(initialMessage);
        }
      } else {
        createBar('Darmowa dostawa od ' + SETTINGS.freeShippingThreshold + ' zł');
      }

      // Pobierz aktualne dane koszyka natychmiast
      fetchCartData();

      // System monitorowania zmian koszyka
      function setupCartMonitoring() {
        console.log('Inicjalizacja monitorowania koszyka...');
        
        // Debounce z krótszym czasem oczekiwania
        const debouncedFetch = debounce(fetchCartData, 200);
        
        // 1. Nasłuchuj na standardowe zdarzenia koszyka
        const cartEvents = [
          'cart:updated', 'cart:refresh', 'cart.requestComplete', 'cart:change',
          'ajaxCart.afterCartLoad', 'cart_update', 'cart.updated'
        ];
        
        cartEvents.forEach(event => {
          document.addEventListener(event, function(e) {
            console.log('Wykryto zdarzenie koszyka:', event);
            debouncedFetch();
          });
        });

        // 2. Obserwuj wszystkie formularze koszyka
        document.addEventListener('submit', function(event) {
          const form = event.target;
          if (form && (
            form.action.includes('/cart/add') ||
            form.action.includes('/cart/change') ||
            form.action.includes('/cart/update') ||
            form.classList.contains('cart') ||
            form.closest('[data-cart]')
          )) {
            console.log('Wykryto wysłanie formularza koszyka');
            setTimeout(debouncedFetch, 500);
          }
        });

        // 3. Obserwuj kliknięcia w elementy związane z koszykiem
        document.addEventListener('click', function(event) {
          const target = event.target;
          const button = target.closest([
            '[name="add"]',
            '.add-to-cart', '.add_to_cart',
            '.cart__remove', '.cart-remove', '.remove-from-cart',
            '[data-cart-remove]', '[data-cart-update]',
            '[href*="/cart/change"]', '[href*="/cart/add"]',
            'form[action*="/cart/add"] button',
            'form[action*="/cart/change"] button',
            '.quantity-selector button', '.qty-btn',
            'input[name="quantity"]'
          ].join(', '));
          
          if (button) {
            console.log('Wykryto kliknięcie w element koszyka:', button);
            setTimeout(debouncedFetch, 800);
          }
        });

        // 4. Obserwuj zmiany w polach ilości
        document.addEventListener('change', function(event) {
          const target = event.target;
          if (target && (
            target.name === 'quantity' ||
            target.name === 'updates' ||
            target.classList.contains('quantity') ||
            target.classList.contains('qty')
          )) {
            console.log('Wykryto zmianę ilości produktu');
            setTimeout(debouncedFetch, 500);
          }
        });

        // 5. Przechwytywanie żądań AJAX
        const originalSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function(data) {
          this.addEventListener('load', function() {
            if (this.responseURL && (
              this.responseURL.includes('/cart/add') || 
              this.responseURL.includes('/cart/change') || 
              this.responseURL.includes('/cart/update') ||
              this.responseURL.includes('/cart/clear')
            )) {
              console.log('Wykryto żądanie AJAX do koszyka:', this.responseURL);
              setTimeout(debouncedFetch, 300);
            }
          });
          return originalSend.apply(this, arguments);
        };

        // 6. Przechwytywanie fetch API
        const originalFetch = window.fetch;
        window.fetch = function(url, options) {
          const promise = originalFetch.apply(this, arguments);
          if (url && typeof url === 'string' && (
            url.includes('/cart/add') || 
            url.includes('/cart/change') || 
            url.includes('/cart/update') ||
            url.includes('/cart/clear')
          )) {
            promise.then(() => {
              console.log('Wykryto żądanie fetch do koszyka:', url);
              setTimeout(debouncedFetch, 300);
            });
          }
          return promise;
        };

        // 7. jQuery AJAX
        if (window.jQuery) {
          const $ = window.jQuery;
          $(document).ajaxComplete(function(event, xhr, settings) {
            if (settings.url && (
              settings.url.includes('/cart/add') || 
              settings.url.includes('/cart/change') || 
              settings.url.includes('/cart/update') ||
              settings.url.includes('/cart/clear')
            )) {
              console.log('Wykryto żądanie jQuery AJAX do koszyka:', settings.url);
              setTimeout(debouncedFetch, 300);
            }
          });

          $(document).on('cart.requestComplete cart:refresh cart_update added.ajaxCart', function() {
            console.log('Wykryto zdarzenie jQuery koszyka');
            debouncedFetch();
          });
        }

        // 8. Sprawdzaj koszyk co 10 sekund gdy strona jest aktywna
        setInterval(function() {
          if (!document.hidden) {
            console.log('Sprawdzanie koszyka - interwał');
            fetchCartData();
          }
        }, 10000);

        // 9. Sprawdź koszyk po powrocie do strony
        document.addEventListener('visibilitychange', function() {
          if (!document.hidden) {
            console.log('Strona stała się aktywna - sprawdzanie koszyka');
            setTimeout(fetchCartData, 200);
          }
        });
      }

      // Inicjalizuj monitorowanie
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setupCartMonitoring();
      } else {
        document.addEventListener('DOMContentLoaded', setupCartMonitoring);
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
    successMessage,
    alwaysShowBar,
    barPosition,
    barTopOffset,
    barHeight,
    fontSize,
    calculateDifference,
    boldText,
    showSuccessMessage,
    // Nowe parametry
    showBorder,
    borderWidth,
    borderColor,
    borderRadius,
    showShadow,
    shadowColor,
    shadowBlur,
    shadowOffsetY
  } = req.body;

  // Walidacja wymaganych pól
  if (
    typeof enabled !== 'boolean' ||
    typeof freeShippingThreshold !== 'number' ||
    !barColor || !textColor || !messageTemplate
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
    successMessage,
    alwaysShowBar,
    barPosition,
    barTopOffset,
    barHeight,
    fontSize,
    calculateDifference,
    boldText,
    showSuccessMessage,
    // Nowe parametry
    showBorder: Boolean(showBorder),
    borderWidth: Number(borderWidth) || 1,
    borderColor: borderColor || '#000000',
    borderRadius: Number(borderRadius) || 0,
    showShadow: Boolean(showShadow),
    shadowColor: shadowColor || 'rgba(0, 0, 0, 0.3)',
    shadowBlur: Number(shadowBlur) || 5,
    shadowOffsetY: Number(shadowOffsetY) || 2
  };

  console.log('Zapisane ustawienia:', settings);
  res.json({ message: 'Ustawienia zapisane pomyślnie', settings });
});

// --- SERWER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('App listening on port ' + PORT);
});
