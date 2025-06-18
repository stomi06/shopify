const express = require('express');
const router = express.Router();
const { pool } = require('../../db'); // Zmienione z '../db' na '../../db'
const { getDefaultSettingsForJS } = require('../utils/defaultSettings');

/**
 * Endpoint dostarczający JavaScript dla ScriptTag (legacy)
 */
router.get('/free-shipping-bar.js', async (req, res) => {
  const shop = req.query.shop;
  
  if (!shop) {
    return res.status(400).send('// Error: Missing shop parameter');
  }

  try {
    // Sprawdź czy ScriptTag jest wyłączony
    const result = await pool.query(
      'SELECT use_scripttag FROM settings WHERE shop = $1',
      [shop]
    );
    
    if (result.rows.length > 0 && result.rows[0].use_scripttag === false) {
      // ScriptTag wyłączony - zwróć pusty kod
      res.setHeader('Content-Type', 'application/javascript');
      return res.send(`
        // ScriptTag disabled - using Theme Extension instead
        console.log('ℹ️ Free Shipping Bar: ScriptTag disabled, Theme Extension active');
      `);
    }
    
    // Pobierz ustawienia z bazy danych
    let settings = await getSettings(shop);
    
    res.type('application/javascript');
    res.send(`
      (function() {
        const SETTINGS = ${JSON.stringify(getDefaultSettingsForJS())};
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
  } catch (error) {
    console.error('Błąd podczas przetwarzania żądania:', error);
    res.status(500).send('// Error: Internal server error');
  }
});

module.exports = router;
