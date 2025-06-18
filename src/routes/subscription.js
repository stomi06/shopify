const express = require('express');
const { shopifyApi } = require('@shopify/shopify-api');
const { getSessionFromStorage } = require('../auth/shopifyAuth');
const { hasActiveSubscription } = require('../../db');
const { SUBSCRIPTION_PRICE_BASIC } = require('../config/shopify');

const router = express.Router();

/**
 * Sprawdzanie statusu subskrypcji
 */
router.get('/api/subscription/check', async (req, res) => {
  const session = await getSessionFromStorage(req.query.shop);
  if (!session) {
    return res.status(401).json({ active: false, message: 'Brak sesji' });
  }
  
  const isActive = await hasActiveSubscription(session);
  res.json({ active: isActive });
});

/**
 * Tworzenie nowej subskrypcji
 */
router.post('/api/subscription/create', async (req, res) => {
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

module.exports = router;
