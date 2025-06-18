require('dotenv').config();
const { 
  getSettings,
  saveSettings, 
  hasActiveSubscription
} = require('./db');

const path = require('path');
const express = require('express');
const axios = require('axios');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const fs = require('fs');
const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use(express.static('public'));

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

// Nowy endpoint do synchronizacji ustawień z Theme Extension
app.get('/api/theme-settings/:shop', (req, res) => {
  const shop = req.params.shop;
  
  // Konwertuj obecne ustawienia na format Theme Extension
  const themeSettings = {
    enabled: settings.enabled,
    threshold: settings.freeShippingThreshold,
    calculate_difference: settings.calculateDifference,
    show_success_message: settings.showSuccessMessage,
    message_template: settings.messageTemplate,
    loading_message: settings.loadingMessage,
    success_message: settings.successMessage,
    bar_color: settings.barColor,
    text_color: settings.textColor,
    font_size: settings.fontSize,
    bold_text: settings.boldText,
    bar_position: settings.barPosition,
    bar_top_offset: settings.barTopOffset,
    bar_height: settings.barHeight,
    bar_width: settings.barWidth,
    transparent_background: settings.transparentBackground,
    show_border: settings.showBorder,
    border_width: settings.borderWidth,
    border_color: settings.borderColor,
    border_radius: settings.borderRadius,
    show_shadow: settings.showShadow,
    shadow_color: settings.shadowColor,
    shadow_blur: settings.shadowBlur,
    shadow_offset_y: settings.shadowOffsetY
  };
  
  res.json(themeSettings);
});

// Endpoint do aktualizacji ustawień z Theme Extension
app.post('/api/theme-settings/:shop', (req, res) => {
  const shop = req.params.shop;
  const newSettings = req.body;
  
  // Aktualizuj globalne ustawienia na podstawie Theme Extension
  Object.assign(settings, {
    enabled: newSettings.enabled,
    freeShippingThreshold: newSettings.threshold,
    calculateDifference: newSettings.calculate_difference,
    showSuccessMessage: newSettings.show_success_message,
    messageTemplate: newSettings.message_template,
    loadingMessage: newSettings.loading_message,
    successMessage: newSettings.success_message,
    barColor: newSettings.bar_color,
    textColor: newSettings.text_color,
    fontSize: newSettings.font_size,
    boldText: newSettings.bold_text,
    barPosition: newSettings.bar_position,
    barTopOffset: newSettings.bar_top_offset,
    barHeight: newSettings.bar_height,
    barWidth: newSettings.bar_width,
    transparentBackground: newSettings.transparent_background,
    showBorder: newSettings.show_border,
    borderWidth: newSettings.border_width,
    borderColor: newSettings.border_color,
    borderRadius: newSettings.border_radius,
    showShadow: newSettings.show_shadow,
    shadowColor: newSettings.shadow_color,
    shadowBlur: newSettings.shadow_blur,
    shadowOffsetY: newSettings.shadow_offset_y
  });
  
  console.log('Settings updated from Theme Extension:', settings);
  res.json({ success: true });
});

// Stałe dla planów subskrypcji
const SUBSCRIPTION_PLAN_BASIC = 'BASIC_PLAN';
const SUBSCRIPTION_PRICE_BASIC = 4.99;

// Funkcja sprawdzająca subskrypcję
async function checkSubscription(shop) {
  // Podczas testów zawsze zwracaj true
  if (process.env.NODE_ENV !== 'production' || true) { // Dodaj "|| true" dla testów
    return true;
  }
  
  try {
    // Tu normalnie sprawdzałbyś rzeczywistą subskrypcję
    return false;
  } catch (error) {
    console.error('Błąd sprawdzania subskrypcji:', error);
    return false;
  }
}

const sessionStore = {};

// Funkcja pobierająca sesję dla sklepu
const getSessionFromStorage = async (shop) => {
  if (!shop) return null;
  
  // W fazie rozwojowej, zawsze zwracaj testową sesję
  if (process.env.NODE_ENV !== 'production') {
    return {
      shop: shop,
      accessToken: 'test_token',
      isActive: () => true,
      isOnline: true
    };
  }
  
  // W rzeczywistej aplikacji, pobierz sesję z SessionStorage
  return sessionStore[shop] || null;
};

// Endpoint do sprawdzania subskrypcji
app.get('/api/subscription/check', async (req, res) => {
  const session = await getSessionFromStorage(req.query.shop);
  if (!session) {
    return res.status(401).json({ active: false, message: 'Brak sesji' });
  }
  
  const isActive = await hasActiveSubscription(session);
  res.json({ active: isActive });
});

// Tworzenie nowej subskrypcji
app.post('/api/subscription/create', async (req, res) => {
  const session = await getSessionFromStorage(req.body.shop);
  if (!session) {
    return res.status(401).json({ error: 'Brak sesji' });
  }
  
  try {
    const client = new shopifyApi.clients.Rest({session});
    const response = await client.post({
      path: 'recurring_application_charges',
      data: {
        recurring_application_charge: {
          name: "Free Delivery Bar",
          price: SUBSCRIPTION_PRICE_BASIC,
          return_url: `https://${req.body.shop}/admin/apps/free-delivery-app`,
          test: process.env.NODE_ENV !== 'production',
          trial_days: 7
        }
      }
    });
    
    const charge = response.body.recurring_application_charge;
    res.json({ success: true, confirmationUrl: charge.confirmation_url });
  } catch (error) {
    console.error('Błąd tworzenia subskrypcji:', error);
    res.status(500).json({ error: "Błąd tworzenia subskrypcji" });
  }
});

// Middleware do sprawdzania subskrypcji
const requireSubscription = async (req, res, next) => {
  const shop = req.query.shop || req.body.shop;
  if (!shop) {
    return res.status(400).json({ error: 'Brak parametru shop' });
  }
  
  const session = await getSessionFromStorage(shop);
  if (!session) {
    return res.status(401).json({ error: 'Brak autoryzacji' });
  }
  
  const isActive = await hasActiveSubscription(session);
  
  if (!isActive) {
    return res.status(403).json({ 
      error: 'Brak aktywnej subskrypcji',
      subscriptionRequired: true
    });
  }
  
  next();
};
/*
// Zabezpiecz endpointy, które wymagają subskrypcji
app.get('/api/settings', requireSubscription, (req, res) => {
  // Istniejący kod obsługi ustawień
});

app.post('/api/settings/update', requireSubscription, (req, res) => {
  // Istniejący kod aktualizacji ustawień
});
*/
// Przechowywanie ustawień (w rzeczywistości użyłbyś bazy danych)
const settingsStore = {};

// Endpoint do pobierania ustawień przez sklep
app.get('/apps/free-delivery/settings', async (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).json({ error: 'Brak parametru shop' });
  }
  
  try {
    // Pobierz ustawienia z bazy danych
    let settings = await getSettings(shop);
    
    // Sprawdź czy sklep ma aktywną subskrypcję
    const hasSubscription = await hasActiveSubscription(shop);
    
    if (!hasSubscription && process.env.NODE_ENV === 'production') {
      // Jeśli nie ma subskrypcji (w produkcji), zwróć tylko podstawowe ustawienia
      return res.json({
        active: false,
        message: "Aktywuj subskrypcję aby włączyć pasek darmowej dostawy"
      });
    }
    
    // Jeśli nie ma ustawień, zwróć domyślne
    if (!settings) {
      settings = getDefaultSettings();
    }
    
    return res.json(settings);
  } catch (error) {
    console.error('Error fetching settings for shop:', shop, error);
    return res.status(500).json({ 
      error: 'Server error',
      message: 'Problem z pobieraniem ustawień'
    });
  }
});

// Dodaj przed app.post('/api/settings/update', requireSession, async (req, res) => { ... })

// Middleware do sprawdzania sesji Shopify
const requireSession = (req, res, next) => {
  try {
    // W trybie testowym zawsze pozwalaj na dostęp
    if (!res.locals) res.locals = {};
    if (!res.locals.shopify) res.locals.shopify = {};
    
    // Ustaw testową sesję
    res.locals.shopify.session = {
      shop: req.query.shop || req.body.shop || 'test-shop.myshopify.com',
      accessToken: 'test_token',
      isActive: () => true
    };
    
    // Kontynuuj
    next();
  } catch (error) {
    console.error('Session error:', error);
    res.status(401).json({ 
      error: 'Authentication error',
      message: error.message 
    });
  }
};

// API do aktualizacji ustawień przez panel administracyjny
app.post('/api/settings/update', requireSession, async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shop = session.shop;
    const settings = req.body;
    
    // Sprawdź subskrypcję (możesz wykomentować na czas testów)
    // const isSubscriptionActive = await hasActiveSubscription(shop);
    // if (!isSubscriptionActive) {
    //   return res.status(403).json({ 
    //     error: 'Brak aktywnej subskrypcji',
    //     subscriptionRequired: true
    //   });
    // }
    
    // Zapisz ustawienia do bazy danych
    await saveSettings(shop, settings);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Znajdź i zamień endpoint API settings - około linia 686
app.get('/api/settings', requireSession, async (req, res) => {
  try {
    const session = res.locals.shopify.session;
    const shop = session.shop;
    
    // Sprawdź subskrypcję
    const isSubscriptionActive = await hasActiveSubscription(shop);
    if (!isSubscriptionActive) {
      return res.status(403).json({ 
        error: 'Brak aktywnej subskrypcji',
        subscriptionRequired: true
      });
    }
    
    // Pobierz ustawienia z bazy danych
    let settings = await getSettings(shop);
    
    // Jeśli nie ma ustawień, zwróć domyślne
    if (!settings) {
      settings = getDefaultSettings();
      await saveSettings(shop, settings);
    }
    
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Funkcja zwracająca domyślne ustawienia
function getDefaultSettings() {
  return {
    active: true,
    threshold: 200,
    calculate_difference: false,
    show_success_message: true,
    message_template: "Darmowa dostawa od {threshold} zł",
    loading_message: "Sprawdzam koszyk...",
    success_message: "Gratulacje! Masz darmową dostawę :)",
    bar_color: "#4CAF50",
    text_color: "#FFFFFF",
    font_size: 16,
    bar_position: "top",
    bar_height: 50
    // inne ustawienia...
  };
}

// --- SERWER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('App listening on port ' + PORT);
});

// Dodaj webhook dla app/uninstalled

app.post('/webhooks/app-uninstalled', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const { uninstallShop } = require('./db');
    // Weryfikacja Shopify HMAC (w prawdziwej implementacji)
    
    const shop = req.get('x-shopify-shop-domain');
    console.log(`App uninstall webhook received for shop: ${shop}`);
    
    if (shop) {
      await uninstallShop(shop);
      console.log(`Shop ${shop} marked as uninstalled`);
    }
    
    res.status(200).send();
  } catch (error) {
    console.error('Error processing app uninstall webhook:', error);
    res.status(500).send();
  }
});