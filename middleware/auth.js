const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('./asyncHandler');

exports.protect = asyncHandler(async (req, res, next) => {
  try {
    // Get token from cookie
    const token = req.cookies.token;

    if (!token) {
      return res.status(401).json({ 
        success: false,
        message: 'Not authorized to access this route - No token provided' 
      });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError.message);
      
      // Clear invalid token
      res.cookie('token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 0,
        expires: new Date(0),
        path: '/'
      });
      
      return res.status(401).json({ 
        success: false,
        message: 'Session expired. Please login again.' 
      });
    }

    // Find user
    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      // Clear token if user not found
      res.cookie('token', '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 0,
        expires: new Date(0),
        path: '/'
      });
      
      return res.status(401).json({ 
        success: false,
        message: 'User not found. Please login again.' 
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ 
      success: false,
      message: 'Not authorized to access this route' 
    });
  }
});