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

// Dodaj nowy endpoint do wyłączania ScriptTag
router.post('/disable-scripttag', async (req, res) => {
  const shop = req.body.shop || req.query.shop;
  
  if (!shop) {
    return res.status(400).json({ error: 'Brak parametru shop' });
  }
  
  try {
    console.log(`🗑️ Disabling ScriptTag for shop: ${shop}`);
    
    // Sprawdź czy shop istnieje w bazie
    const checkResult = await pool.query(
      'SELECT id FROM settings WHERE shop = $1',
      [shop]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Shop not found' });
    }
    
    // Dodaj kolumnę use_scripttag jeśli nie istnieje
    await pool.query(`
      ALTER TABLE settings 
      ADD COLUMN IF NOT EXISTS use_scripttag BOOLEAN DEFAULT true
    `);
    
    // Wyłącz ScriptTag
    await pool.query(
      'UPDATE settings SET use_scripttag = false WHERE shop = $1',
      [shop]
    );
    
    res.json({ 
      success: true, 
      message: 'ScriptTag disabled - Theme Extension will be used instead' 
    });
  } catch (error) {
    console.error('Error disabling ScriptTag:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
