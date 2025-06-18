const express = require('express');
const { getSettings, saveSettings, hasActiveSubscription } = require('../../db');
const { getDefaultSettings } = require('../utils/defaultSettings');
const { requireSession } = require('../middleware/auth');

const router = express.Router();

/**
 * API do pobierania ustawień przez panel administracyjny
 */
router.get('/api/settings', requireSession, async (req, res) => {
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

/**
 * API do aktualizacji ustawień przez panel administracyjny
 */
router.post('/api/settings/update', requireSession, async (req, res) => {
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

module.exports = router;
