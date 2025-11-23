const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { validateEmail, validatePassword, rateLimiter } = require('../middleware/validation');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Constants
const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRE = process.env.JWT_EXPIRE || '30d';
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

// Validation
const validateRequest = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid request body' 
    });
  }
  next();
};

// Error messages
const ERROR_MESSAGES = {
  INVALID_REQUEST: 'Invalid request body',
  NAME_TOO_SHORT: 'Name must be at least 2 characters long',
  USER_EXISTS: 'User already exists',
  REGISTRATION_FAILED: 'Registration failed',
  CREDENTIALS_REQUIRED: 'Please provide email and password',
  INVALID_CREDENTIALS: 'Invalid credentials',
  LOGIN_FAILED: 'Login failed',
  SERVER_ERROR: 'Internal server error'
};

// Helper: generate JWT
const generateToken = (id) => {
  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }
  
  return jwt.sign({ id }, JWT_SECRET, {
    expiresIn: JWT_EXPIRE,
    issuer: 'quiz-app',
    audience: 'quiz-app-users'
  });
};

// Helper: common cookie options
const getCookieOptions = () => {
  const options = {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  };

  // Only set domain in production for cross-domain cookies
  if (IS_PROD && process.env.COOKIE_DOMAIN) {
    options.domain = process.env.COOKIE_DOMAIN;
  }

  return options;
};

// Helper: set auth cookie
const setAuthCookie = (res, token) => {
  if (!token) {
    throw new Error('Token is required to set auth cookie');
  }
  
  res.cookie('token', token, getCookieOptions());
};

// Helper: sanitize user data
const sanitizeUser = (user) => ({
  id: user._id || user.id,
  name: user.name,
  email: user.email,
  role: user.role
});

// Register
router.post('/register', 
  validateRequest,
  validateEmail, 
  validatePassword, 
  asyncHandler(async (req, res) => {
    let { name, email, password, role } = req.body;

    // Validate name
    if (!name || !name.trim() || name.trim().length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: ERROR_MESSAGES.NAME_TOO_SHORT 
      });
    }

    name = name.trim();
    email = String(email || '').trim().toLowerCase();

    // Check if user exists
    const existingUser = await User.findOne({ email }).lean();
    if (existingUser) {
      return res.status(409).json({ 
        success: false, 
        message: ERROR_MESSAGES.USER_EXISTS 
      });
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
      user: sanitizeUser(user)
    });
  })
);

// Login
router.post('/login', 
  validateRequest,
  rateLimiter, 
  validateEmail, 
  asyncHandler(async (req, res) => {
    let { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: ERROR_MESSAGES.CREDENTIALS_REQUIRED 
      });
    }

    email = String(email).trim().toLowerCase();

    const user = await User.findOne({ email }).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ 
        success: false, 
        message: ERROR_MESSAGES.INVALID_CREDENTIALS 
      });
    }

    const token = generateToken(user._id);
    setAuthCookie(res, token);

    return res.json({
      success: true,
      user: sanitizeUser(user)
    });
  })
);

// Get current user
router.get('/me', protect, asyncHandler(async (req, res) => {
  return res.json({
    success: true,
    user: sanitizeUser(req.user)
  });
}));

// Logout
router.post('/logout', (req, res) => {
  try {
    res.cookie('token', '', {
      ...getCookieOptions(),
      maxAge: 0,
      expires: new Date(0)
    });

    return res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  } catch (error) {
    // Even if cookie clearing fails, we should respond successfully
    console.error('Logout cookie clearing error:', error);
    return res.json({ 
      success: true, 
      message: 'Logged out successfully' 
    });
  }
});

// Check auth status (lightweight version of /me)
router.get('/check', protect, (req, res) => {
  return res.json({
    success: true,
    authenticated: true,
    user: sanitizeUser(req.user)
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ 
    success: true, 
    message: 'Auth service is healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;