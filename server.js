// ============================================
// TripGenius AI — Main Server (V2 Expanded)
// ============================================

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']); // Force Google DNS — fixes mongodb+srv lookup issues

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();

// ===== MIDDLEWARE =====
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===== DATABASE =====
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tripgenius')
  .then(() => console.log('✅ MongoDB connected!'))
  .catch(err => console.error('❌ MongoDB error:', err.message));

// ===== ROUTE IMPORTS =====
const {
  vehicleRouter, bookingRouter, reviewRouter, groupRouter,
  destRouter, mapsRouter, userRouter, adminRouter, couponRouter,
} = require('./routes/all-routes');

// ===== ROUTES =====
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/trips',        require('./routes/trips'));
app.use('/api/ai',           require('./routes/ai'));
app.use('/api/listings',     require('./routes/listings'));
app.use('/api/vehicles',     vehicleRouter);
app.use('/api/bookings',     bookingRouter);
app.use('/api/reviews',      reviewRouter);
app.use('/api/groups',       groupRouter);
app.use('/api/destinations', destRouter);
app.use('/api/maps',         mapsRouter);
app.use('/api/users',        userRouter);
app.use('/api/admin',        adminRouter);
app.use('/api/coupons',      couponRouter);

app.get('/api/health', (req, res) => res.json({
  success: true, message: 'TripGenius AI V2 chal raha hai! 🚀', time: new Date().toISOString()
}));

app.get('/api', (req, res) => res.json({
  name: 'TripGenius AI API V2',
  endpoints: {
    auth: ['POST /api/auth/register', 'POST /api/auth/login', 'GET /api/auth/me'],
    ai: ['POST /api/ai/generate-trip', 'POST /api/ai/recommend-destinations', 'POST /api/ai/route-plan', 'POST /api/ai/budget-optimize'],
    listings: ['GET /api/listings', 'POST /api/listings', 'GET /api/listings/:id'],
    vehicles: ['GET /api/vehicles', 'POST /api/vehicles'],
    bookings: ['POST /api/bookings', 'GET /api/bookings/my', 'POST /api/bookings/:id/confirm-payment'],
    maps: ['GET /api/maps/near-me', 'GET /api/maps/heatmap'],
    groups: ['POST /api/groups', 'GET /api/groups/public', 'GET /api/groups/buddies/find'],
    destinations: ['GET /api/destinations', 'GET /api/destinations/:id'],
    admin: ['GET /api/admin/stats', 'GET /api/admin/listings/pending'],
  }
}));

app.use((req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.url}` }));

app.use((err, req, res, next) => {
  console.error('❌', err.message);
  res.status(err.status || 500).json({ success: false, message: err.message || 'Server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 TripGenius V2 server: http://localhost:${PORT}`);
  console.log(`📖 API docs: http://localhost:${PORT}/api`);
  console.log(`🏥 Health: http://localhost:${PORT}/api/health\n`);
});

module.exports = app;
