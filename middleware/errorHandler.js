// Global error handler
exports.errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(400).json({
      message: `An account with this ${field} already exists`
    });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({
      message: messages.join(', ')
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      message: 'Invalid token. Please log in again'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      message: 'Your session has expired. Please log in again'
    });
  }

  // Default error
  res.status(err.statusCode || 500).json({
    message: err.message || 'An unexpected error occurred. Please try again later'
  });
};

// 404 handler
exports.notFound = (req, res) => {
  res.status(404).json({
    message: 'Route not found'
  });
};
