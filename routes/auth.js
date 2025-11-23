// backend/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { validateEmail, validatePassword, rateLimiter } = require('../middleware/validation');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';

// Helper: generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

// Helper: common cookie options
const getCookieOptions = () => ({
  httpOnly: true,
  secure: isProd,                     // true on Render (HTTPS)
  sameSite: isProd ? 'none' : 'lax', // 'none' for cross-site (Vercel <-> Render)
  maxAge: 30 * 24 * 60 * 60 * 1000,  // 30 days
  path: '/',                         // send for all routes
});

// Helper: set auth cookie
const setAuthCookie = (res, token) => {
  res.cookie('token', token, getCookieOptions());
};

// Register
router.post('/register', validateEmail, validatePassword, async (req, res) => {
  try {
    let { name, email, password, role } = req.body;

    if (!name || name.trim().length < 2) {
      return res.status(400).json({ message: 'Name must be at least 2 characters long' });
    }

    name = name.trim();
    email = String(email || '').trim().toLowerCase();

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      role: role || 'faculty'
    });

    const token = generateToken(user._id);
    setAuthCookie(res, token);

    return res.status(201).json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('POST /auth/register error:', error);
    return res.status(400).json({ message: error.message || 'Registration failed' });
  }
});

// Login
router.post('/login', rateLimiter, validateEmail, async (req, res) => {
  try {
    let { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    email = String(email).trim().toLowerCase();

    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);
    setAuthCookie(res, token);

    return res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('POST /auth/login error:', error);
    return res.status(400).json({ message: error.message || 'Login failed' });
  }
});

// Get current user
router.get('/me', protect, async (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role
    }
  });
});

// Logout
router.post('/logout', (req, res) => {
  // Clear cookie using same options so browser actually removes it
  res.cookie('token', '', {
    ...getCookieOptions(),
    maxAge: 0,
    expires: new Date(0)
  });

  return res.json({ success: true, message: 'Logged out successfully' });
});

module.exports = router;
