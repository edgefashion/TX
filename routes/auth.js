// routes/auth.js — Register, Login, Profile

const express = require('express');
const router = express.Router();
const { User } = require('../models');
const { protect } = require('../middleware/auth');

// Helper — token bhejo response mein
const sendToken = (user, statusCode, res) => {
  const token = user.getJWT();
  res.status(statusCode).json({
    success: true,
    token,
    user: {
      id:    user._id,
      name:  user.name,
      email: user.email,
      role:  user.role,
      avatar:user.avatar,
    }
  });
};

// ─────────────────────────────────────
// POST /api/auth/register — Naya account banao
// ─────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;

    // Check karo pehle se exist karta hai?
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Yeh email already registered hai.' });
    }

    const user = await User.create({ name, email, password, role: role || 'traveler', phone });
    sendToken(user, 201, res);

  } catch (err) {
    if (err.name === 'ValidationError') {
      const msgs = Object.values(err.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: msgs.join(', ') });
    }
    res.status(500).json({ success: false, message: 'Registration fail hui: ' + err.message });
  }
});

// ─────────────────────────────────────
// POST /api/auth/login — Login karo
// ─────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email aur password dono chahiye.' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Email ya password galat hai.' });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Account deactivated hai. Support se contact karo.' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Email ya password galat hai.' });
    }

    // Last login update karo
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    sendToken(user, 200, res);

  } catch (err) {
    res.status(500).json({ success: false, message: 'Login fail hua: ' + err.message });
  }
});

// ─────────────────────────────────────
// GET /api/auth/me — Apni profile dekho
// ─────────────────────────────────────
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .populate('savedTrips', 'destination days budget mood createdAt')
      .populate('wishlist', 'name state emoji');

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────
// PUT /api/auth/update — Profile update karo
// ─────────────────────────────────────
router.put('/update', protect, async (req, res) => {
  try {
    const allowed = ['name', 'phone', 'avatar', 'preferences'];
    const updates = {};
    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const user = await User.findByIdAndUpdate(req.user.id, updates, {
      new: true,
      runValidators: true
    });

    res.json({ success: true, message: 'Profile update ho gaya!', user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────
// PUT /api/auth/change-password — Password change karo
// ─────────────────────────────────────
router.put('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');
    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password galat hai.' });
    }

    user.password = newPassword;
    await user.save();

    sendToken(user, 200, res);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
