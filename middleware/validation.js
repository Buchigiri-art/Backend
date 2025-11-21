const validator = require('validator');

// Email validation
exports.validateEmail = (req, res, next) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }
  
  if (!validator.isEmail(email)) {
    return res.status(400).json({ message: 'Please provide a valid email address' });
  }
  
  // Additional security: normalize email
  req.body.email = validator.normalizeEmail(email);
  next();
};

// Password validation
exports.validatePassword = (req, res, next) => {
  const { password } = req.body;
  
  if (!password) {
    return res.status(400).json({ message: 'Password is required' });
  }
  
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }
  
  // Check for strong password
  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    return res.status(400).json({ 
      message: 'Password must contain at least one uppercase letter, one lowercase letter, and one number' 
    });
  }
  
  next();
};

// Sanitize input to prevent injection attacks
exports.sanitizeInput = (req, res, next) => {
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        // Remove potential malicious characters
        req.body[key] = validator.escape(req.body[key].trim());
      }
    });
  }
  next();
};

// Rate limiting data
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

// Rate limiting middleware
exports.rateLimiter = (req, res, next) => {
  const identifier = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!loginAttempts.has(identifier)) {
    loginAttempts.set(identifier, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }
  
  const attempts = loginAttempts.get(identifier);
  
  if (now > attempts.resetTime) {
    loginAttempts.set(identifier, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return next();
  }
  
  if (attempts.count >= MAX_ATTEMPTS) {
    const timeLeft = Math.ceil((attempts.resetTime - now) / 1000 / 60);
    return res.status(429).json({ 
      message: `Too many login attempts. Please try again in ${timeLeft} minutes` 
    });
  }
  
  attempts.count++;
  next();
};

// Clean up old rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [identifier, attempts] of loginAttempts.entries()) {
    if (now > attempts.resetTime) {
      loginAttempts.delete(identifier);
    }
  }
}, RATE_LIMIT_WINDOW);
