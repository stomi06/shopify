const express = require('express');
const router = express.Router();
const { getSettings } = require('../../db');
const { getDefaultSettings } = require('../utils/defaultSettings');

/**
 * App-proxy endpoint dla Theme Extension
 * Route: /free-delivery/settings
 */
router.get('/free-delivery/settings', async (req, res) => {
  try {
    // Sprawdź parametry uwierzytelniające (w produkcji)
    const shop = req.query.shop;
    
    if (!shop) {
      return res.status(400).json({ error: 'Brak parametru shop' });
    }
    
    // Pobierz ustawienia z bazy danych
    const settings = await getSettings(shop) || getDefaultSettings();
    
    // Zwróć ustawienia jako JSON
    return res.json(settings);
  } catch (error) {
    console.error('Error in app-proxy settings:', error);
    return res.json(getDefaultSettings());
  }
});

module.exports = router;
