// middleware/auth.js — JWT Authentication

const jwt = require('jsonwebtoken');
const { User } = require('../models');

// ===== PROTECT ROUTE — Login zaroori =====
exports.protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Login karo pehle.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    const user = await User.findById(decoded.id);

    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'User nahi mila ya deactivated hai.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expire ho gaya. Dobara login karo.' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
};

// ===== ROLE CHECK =====
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Yeh kaam ${req.user.role} nahi kar sakta. Required: ${roles.join(', ')}`
      });
    }
    next();
  };
};

// ===== OPTIONAL AUTH — Login karo ya mat karo =====
exports.optionalAuth = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
      req.user = await User.findById(decoded.id);
    }
  } catch (e) {}
  next();
};
