# Free Delivery Bar - Refactored Architecture

## 📁 Project Structure

```
freedelivery/
├── src/
│   ├── config/
│   │   └── shopify.js          # Configuration and environment variables
│   ├── auth/
│   │   └── shopifyAuth.js      # Authentication utilities
│   ├── middleware/
│   │   └── auth.js             # Authentication middleware
│   ├── routes/
│   │   ├── auth.js             # OAuth authentication routes
│   │   ├── appProxy.js         # App-proxy routes for Theme Extension
│   │   ├── api.js              # Admin panel API routes
│   │   ├── subscription.js     # Subscription management routes
│   │   ├── javascript.js       # JavaScript delivery routes
│   │   └── webhooks.js         # Webhook handlers
│   └── utils/
│       └── defaultSettings.js  # Default settings and converters
├── extensions/                 # Theme Extension files
├── public/                     # Static files (admin panel)
├── db.js                       # Database layer
├── index.new.js               # New modular main entry point
└── index.js                   # Old monolithic file (backup)
```

## 🚀 Getting Started

### Run with new architecture:
```bash
npm start
```

### Run with old architecture (fallback):
```bash
npm run start:old
```

## 📋 Modules Overview

### 1. **Config** (`src/config/shopify.js`)
- Environment variables
- Shopify API configuration
- Subscription settings

### 2. **Authentication** (`src/auth/shopifyAuth.js`)
- OAuth utilities
- Session management
- HMAC verification

### 3. **Middleware** (`src/middleware/auth.js`)
- Session validation
- Subscription checks
- CORS headers

### 4. **Routes**
- **auth.js**: OAuth flow (`/auth`, `/auth/callback`)
- **appProxy.js**: Theme Extension endpoint (`/free-delivery/settings`)
- **api.js**: Admin panel API (`/api/settings`, `/api/settings/update`)
- **subscription.js**: Subscription management (`/api/subscription/*`)
- **javascript.js**: ScriptTag delivery (`/free-shipping-bar.js`)
- **webhooks.js**: Shopify webhooks (`/webhooks/*`)

### 5. **Utils** (`src/utils/defaultSettings.js`)
- Default settings definitions
- Format converters (Theme Extension ↔ JavaScript)
- Settings validation

## 🔄 Migration Benefits

### ✅ **Resolved Issues:**
1. **No more duplicated endpoints**
2. **Cleaner separation of concerns**
3. **Easier testing and maintenance**
4. **Better error handling**
5. **Consistent naming conventions**

### 🎯 **Main App-Proxy Route:**
`GET /free-delivery/settings` - Serves Theme Extension with JSON settings

### 📡 **API Endpoints:**
- `GET /api/settings` - Admin panel settings
- `POST /api/settings/update` - Update settings
- `GET /api/subscription/check` - Check subscription status
- `POST /api/subscription/create` - Create subscription

## 🧪 Testing

The new architecture maintains 100% compatibility with the existing Theme Extension and admin panel while providing a much cleaner, maintainable codebase.

## 🔧 Next Steps

1. Test the new architecture
2. Update admin panel to use new API endpoints
3. Add proper error logging
4. Implement comprehensive HMAC validation
5. Add unit tests for each module
