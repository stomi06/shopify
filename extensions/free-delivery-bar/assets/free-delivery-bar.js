// Free Delivery Bar JavaScript
(function() {
  'use strict';
  
  document.addEventListener('DOMContentLoaded', function() {
    const deliveryBar = document.querySelector('.free-delivery-bar');
    
    if (!deliveryBar) return;
    
    // Sprawdź czy pasek już był zamknięty w tej sesji
    const barId = 'free-delivery-bar-' + Date.now();
    const wasClosed = sessionStorage.getItem('free-delivery-bar-closed');
    
    if (wasClosed) {
      deliveryBar.style.display = 'none';
      return;
    }
    
    // Obsłuż zamykanie paska
    const closeButton = deliveryBar.querySelector('button');
    if (closeButton) {
      closeButton.addEventListener('click', function() {
        deliveryBar.style.animation = 'slideUp 0.3s ease-out reverse';
        setTimeout(function() {
          deliveryBar.style.display = 'none';
          sessionStorage.setItem('free-delivery-bar-closed', 'true');
        }, 300);
      });
    }
    
    // Jeśli pasek jest na dole, dodaj padding do body
    if (deliveryBar.style.position === 'fixed' && deliveryBar.style.bottom === '0px') {
      document.body.style.paddingBottom = deliveryBar.offsetHeight + 'px';
    }
  });
})();
