const express = require('express');

const router = express.Router();

/**
 * Webhook do obsługi odinstalowania aplikacji
 */
router.post('/webhooks/app-uninstalled', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const { uninstallShop } = require('../../db');
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

module.exports = router;
