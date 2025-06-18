require('dotenv').config();
const { Pool } = require('pg');

// Konfiguracja połączenia z bazą danych PostgreSQL
const pool = new Pool({
  host: process.env.PGHOST,
  user: process.env.PGUSER,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  password: process.env.PGPASSWORD,
  ssl: {
    rejectUnauthorized: false // może być potrzebne dla Azure PostgreSQL
  }
});

// Testowe połączenie przy starcie aplikacji
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to PostgreSQL database:', err);
  } else {
    console.log('Connected to PostgreSQL database at:', res.rows[0].now);
  }
});

// Funkcje dostępu do danych - shops
async function getShopByDomain(shopDomain) {
  const query = 'SELECT * FROM shops WHERE shop_domain = $1 AND uninstalled_at IS NULL';
  const { rows } = await pool.query(query, [shopDomain]);
  return rows[0];
}

async function createShop(shopDomain, accessToken, scope) {
  const query = `
    INSERT INTO shops (shop_domain, access_token, scope)
    VALUES ($1, $2, $3)
    ON CONFLICT (shop_domain) 
    DO UPDATE SET access_token = $2, scope = $3, uninstalled_at = NULL
    RETURNING *
  `;
  
  const { rows } = await pool.query(query, [shopDomain, accessToken, scope]);
  return rows[0];
}

async function uninstallShop(shopDomain) {
  const query = `
    UPDATE shops
    SET uninstalled_at = CURRENT_TIMESTAMP
    WHERE shop_domain = $1
  `;
  
  return pool.query(query, [shopDomain]);
}

// Funkcje dostępu do danych - settings
async function getSettings(shopDomain) {
  const query = `
    SELECT s.*
    FROM settings s
    JOIN shops sh ON s.shop_id = sh.id
    WHERE sh.shop_domain = $1
  `;
  
  const { rows } = await pool.query(query, [shopDomain]);
  return rows[0] || null;
}

async function saveSettings(shopDomain, settings) {
  // Najpierw znajdź lub stwórz sklep
  let shop = await getShopByDomain(shopDomain);
  
  if (!shop) {
    // Jeśli nie znaleziono sklepu, utwórz pusty rekord
    shop = await createShop(shopDomain, null, null);
  }
  
  // Sprawdź czy istnieją ustawienia dla tego sklepu
  const existingSettings = await getSettings(shopDomain);
  
  if (existingSettings) {
    // Aktualizuj istniejące ustawienia
    const query = `
      UPDATE settings
      SET active = $1,
          threshold = $2,
          calculate_difference = $3,
          show_success_message = $4,
          message_template = $5,
          loading_message = $6, 
          success_message = $7,
          bar_color = $8,
          text_color = $9,
          font_size = $10,
          bar_position = $11,
          bar_height = $12,
          transparent_background = $13,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $14
      RETURNING *
    `;
    
    const values = [
      settings.active || false,
      settings.threshold || 200.00,
      settings.calculate_difference || false,
      settings.show_success_message || true,
      settings.message_template || 'Darmowa dostawa od {threshold} zł',
      settings.loading_message || 'Sprawdzam koszyk...',
      settings.success_message || 'Gratulacje! Masz darmową dostawę :)',
      settings.bar_color || '#4CAF50',
      settings.text_color || '#FFFFFF',
      settings.font_size || 16,
      settings.bar_position || 'top',
      settings.bar_height || 50,
      settings.transparent_background || false,
      existingSettings.id
    ];
    
    const { rows } = await pool.query(query, values);
    return rows[0];
  } else {
    // Wstaw nowe ustawienia
    const query = `
      INSERT INTO settings (
        shop_id, active, threshold, calculate_difference, show_success_message,
        message_template, loading_message, success_message, bar_color, text_color,
        font_size, bar_position, bar_height, transparent_background
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;
    
    const values = [
      shop.id,
      settings.active || false,
      settings.threshold || 200.00,
      settings.calculate_difference || false,
      settings.show_success_message || true,
      settings.message_template || 'Darmowa dostawa od {threshold} zł',
      settings.loading_message || 'Sprawdzam koszyk...',
      settings.success_message || 'Gratulacje! Masz darmową dostawę :)',
      settings.bar_color || '#4CAF50',
      settings.text_color || '#FFFFFF',
      settings.font_size || 16,
      settings.bar_position || 'top',
      settings.bar_height || 50,
      settings.transparent_background || false
    ];
    
    const { rows } = await pool.query(query, values);
    return rows[0];
  }
}

// Funkcje dostępu do danych - subscription
async function getSubscription(shopDomain) {
  const query = `
    SELECT s.*
    FROM subscriptions s
    JOIN shops sh ON s.shop_id = sh.id
    WHERE sh.shop_domain = $1
    ORDER BY s.created_at DESC
    LIMIT 1
  `;
  
  const { rows } = await pool.query(query, [shopDomain]);
  return rows[0] || null;
}

async function createSubscription(shopDomain, planName, subscriptionId, status) {
  // Znajdź sklep
  const shop = await getShopByDomain(shopDomain);
  
  if (!shop) {
    throw new Error(`Shop ${shopDomain} not found`);
  }
  
  const query = `
    INSERT INTO subscriptions (
      shop_id, plan_name, subscription_id, status
    )
    VALUES ($1, $2, $3, $4)
    RETURNING *
  `;
  
  const values = [shop.id, planName, subscriptionId, status || 'pending'];
  const { rows } = await pool.query(query, values);
  return rows[0];
}

async function updateSubscription(subscriptionId, status, trialEndsAt, billingOn) {
  const query = `
    UPDATE subscriptions
    SET status = $1,
        trial_ends_at = $2,
        billing_on = $3,
        updated_at = CURRENT_TIMESTAMP
    WHERE subscription_id = $4
    RETURNING *
  `;
  
  const values = [status, trialEndsAt, billingOn, subscriptionId];
  const { rows } = await pool.query(query, values);
  return rows[0];
}

async function hasActiveSubscription(shopDomain) {
  // W trybie rozwojowym zawsze zwracaj true
  if (process.env.NODE_ENV !== 'production' || true) {
    return true; // Dodaj "|| true" aby zawsze zwracało true
  }

  const query = `
    SELECT COUNT(*) as count
    FROM subscriptions s
    JOIN shops sh ON s.shop_id = sh.id
    WHERE sh.shop_domain = $1
      AND s.status = 'active'
      AND (s.billing_on > CURRENT_TIMESTAMP OR s.trial_ends_at > CURRENT_TIMESTAMP)
  `;
  
  const { rows } = await pool.query(query, [shopDomain]);
  return rows[0].count > 0;
}

// Eksportuj funkcje
module.exports = {
  // Połączenie
  pool,
  
  // Funkcje dla shops
  getShopByDomain,
  createShop,
  uninstallShop,
  
  // Funkcje dla settings
  getSettings,
  saveSettings,
  
  // Funkcje dla subscriptions
  getSubscription,
  createSubscription,
  updateSubscription,
  hasActiveSubscription
};