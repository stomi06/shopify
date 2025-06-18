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
    messageTemplate: 'Darmowa dostawa od 200 zł',
    loadingMessage: 'Aktualizuję dane z koszyka',
    successMessage: 'Gratulacje! Masz darmową dostawę :)',
    alwaysShowBar: true,
    barPosition: 'fixed',
    barTopOffset: 70,
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
    shadowOffsetY: 2,       // w px
    // Nowa opcja
    transparentBackground: false,
    // Szerokość paska
    barWidth: 100  // szerokość paska w procentach (domyślnie 100%)
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

      // Natychmiast wstrzyknij CSS do <head>, żeby pasek wyświetlał się bez opóźnień
      const styleElement = document.createElement('style');
      styleElement.textContent = \`
        #free-shipping-bar-container {
          position: \${SETTINGS.barPosition};
          top: \${SETTINGS.barTopOffset}px;
          left: 0;
          width: 100%;
          display: flex;
          justify-content: center;
          z-index: 9999;
          transition: opacity 0.3s;
        }
        #free-shipping-bar {
          width: \${SETTINGS.barWidth}%;
          height: \${SETTINGS.barHeight}px;
          background-color: \${SETTINGS.transparentBackground ? 'transparent' : SETTINGS.barColor};
          box-sizing: border-box;
          \${SETTINGS.showBorder ? \`
            border: \${SETTINGS.borderWidth}px solid \${SETTINGS.borderColor};
            border-radius: \${SETTINGS.borderRadius}px;
          \` : ''}
          \${SETTINGS.showShadow ? \`
            box-shadow: 0 \${SETTINGS.shadowOffsetY}px \${SETTINGS.shadowBlur}px \${SETTINGS.shadowColor};
          \` : ''}
        }
        #free-shipping-bar-text {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          height: 100%;
          color: \${SETTINGS.textColor};
          font-size: \${SETTINGS.fontSize}px;
          font-weight: \${SETTINGS.boldText ? 'bold' : 'normal'};
          text-align: center;
        }
      \`;
      document.head.appendChild(styleElement);

      // Funkcja pomocnicza "debounce"
      function debounce(func, wait) {
        let timeout;
        return function(...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => func.apply(this, args), wait);
        };
      }

      // Funkcja tworząca lub aktualizująca pasek
      function createBar(text) {
        // Utworzenie kontenera zewnętrznego, jeśli jeszcze nie istnieje
        let outerContainer = document.getElementById('free-shipping-bar-container');
        if (!outerContainer) {
          outerContainer = document.createElement('div');
          outerContainer.id = 'free-shipping-bar-container';
          outerContainer.style.position = SETTINGS.barPosition;
          outerContainer.style.top = SETTINGS.barTopOffset + 'px';
          outerContainer.style.left = '0';
          outerContainer.style.width = '100%';
          outerContainer.style.display = 'flex';
          outerContainer.style.justifyContent = 'center';
          outerContainer.style.zIndex = '2';
          document.body.appendChild(outerContainer);
        }

        // Utworzenie lub pobranie głównego paska
        let bar = document.getElementById('free-shipping-bar');
        let textElement = document.getElementById('free-shipping-bar-text');
        
        if (!bar) {
          // Tworzymy główny pasek
          bar = document.createElement('div');
          bar.id = 'free-shipping-bar';
          
          // Tworzymy element do tekstu
          textElement = document.createElement('div');
          textElement.id = 'free-shipping-bar-text';
          
          // Konfiguracja głównego paska
          bar.style.width = SETTINGS.barWidth + '%';
          bar.style.height = SETTINGS.barHeight + 'px';
          bar.style.backgroundColor = SETTINGS.transparentBackground ? 'transparent' : SETTINGS.barColor;
          bar.style.boxSizing = 'border-box';
          
          // Dodanie stylów dla ramki
          if (SETTINGS.showBorder) {
            bar.style.borderWidth = SETTINGS.borderWidth + 'px';
            bar.style.borderStyle = 'solid';
            bar.style.borderColor = SETTINGS.borderColor;
            bar.style.borderRadius = SETTINGS.borderRadius + 'px';
          }
          
          // Dodanie stylów dla cienia
          if (SETTINGS.showShadow) {
            bar.style.boxShadow = \`0 \${SETTINGS.shadowOffsetY}px \${SETTINGS.shadowBlur}px \${SETTINGS.shadowColor}\`;
          }
          
          // Konfiguracja elementu tekstowego - używamy flexbox do doskonałego centrowania
          textElement.style.display = 'flex';
          textElement.style.alignItems = 'center';
          textElement.style.justifyContent = 'center';
          textElement.style.width = '100%';
          textElement.style.height = '100%';
          textElement.style.color = SETTINGS.textColor;
          textElement.style.fontSize = SETTINGS.fontSize + 'px';
          textElement.style.fontWeight = SETTINGS.boldText ? 'bold' : 'normal';
          textElement.style.textAlign = 'center';
          textElement.style.boxSizing = 'border-box';
          
          // Składamy strukturę
          bar.appendChild(textElement);
          outerContainer.appendChild(bar);
        } else {
          // Pobierz lub utwórz element tekstowy, jeśli nie istnieje
          if (!textElement) {
            textElement = document.createElement('div');
            textElement.id = 'free-shipping-bar-text';
            textElement.style.display = 'flex';
            textElement.style.alignItems = 'center';
            textElement.style.justifyContent = 'center';
            textElement.style.width = '100%';
            textElement.style.height = '100%';
            textElement.style.textAlign = 'center';
            textElement.style.boxSizing = 'border-box';
            bar.appendChild(textElement);
          }
          
          // Aktualizacja stylów istniejącego paska
          bar.style.width = SETTINGS.barWidth + '%';
          bar.style.backgroundColor = SETTINGS.transparentBackground ? 'transparent' : SETTINGS.barColor;
          bar.style.height = SETTINGS.barHeight + 'px';
          bar.style.boxSizing = 'border-box';
          
          // Aktualizacja ramki
          if (SETTINGS.showBorder) {
            bar.style.borderWidth = SETTINGS.borderWidth + 'px';
            bar.style.borderStyle = 'solid';
            bar.style.borderColor = SETTINGS.borderColor;
            bar.style.borderRadius = SETTINGS.borderRadius + 'px';
          } else {
            bar.style.border = 'none';
          }
          
          // Aktualizacja cienia
          if (SETTINGS.showShadow) {
            bar.style.boxShadow = \`0 \${SETTINGS.shadowOffsetY}px \${SETTINGS.shadowBlur}px \${SETTINGS.shadowColor}\`;
          } else {
            bar.style.boxShadow = 'none';
          }
          
          // Aktualizacja stylów tekstu
          textElement.style.color = SETTINGS.textColor;
          textElement.style.fontSize = SETTINGS.fontSize + 'px';
          textElement.style.fontWeight = SETTINGS.boldText ? 'bold' : 'normal';
        }
        
        // Ustawiamy tekst
        textElement.textContent = text;
        outerContainer.style.display = 'flex';
        
        return bar;
      }

      // Funkcja ukrywająca pasek
      function hideBar() {
        const container = document.getElementById('free-shipping-bar-container');
        if (container) {
          container.style.display = 'none';
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
      
      // Natychmiast utwórz pasek z domyślnym komunikatem
      if (!SETTINGS.calculateDifference) {
        // Tryb statyczny - od razu wyświetl kompletny komunikat
        createBar(SETTINGS.messageTemplate);
      } else {
        // Tryb dynamiczny - najpierw pokaż domyślny lub zapisany komunikat
        if (lastCartState) {
          const initialMessage = generateShippingMessage(lastCartState.total);
          if (initialMessage !== null) {
            createBar(initialMessage);
          } else {
            createBar(SETTINGS.loadingMessage || 'Sprawdzam koszyk...');
          }
        } else {
          // Brak zapisanych danych - pokaż domyślny komunikat ładowania
          createBar(SETTINGS.loadingMessage || 'Sprawdzam koszyk...');
        }
      }

      // Funkcja do natychmiastowego ładowania przy pierwszym wejściu na stronę
      function initializeBar() {
        // Pobierz aktualne dane koszyka po krótkim opóźnieniu
        setTimeout(fetchCartData, 100);
        
        // Przygotuj system monitorowania koszyka
        setupCartMonitoring();
      }

      // Uruchom inicjalizację natychmiast lub gdy DOM jest gotowy
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initializeBar();
      } else {
        document.addEventListener('DOMContentLoaded', initializeBar);
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
    shadowOffsetY,
    transparentBackground,
    barWidth
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
    shadowOffsetY: Number(shadowOffsetY) || 2,
    transparentBackground: Boolean(transparentBackground),
    barWidth: Number(barWidth) || 100
  };

  console.log('Zapisane ustawienia:', settings);
  res.json({ message: 'Ustawienia zapisane pomyślnie', settings });
});

// --- SERWER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('App listening on port ' + PORT);
});