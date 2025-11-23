const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const cookieParser = require('cookie-parser');

const { errorHandler, notFound } = require('./middleware/errorHandler');
const { createIndexes } = require('./config/dbIndexes');
const { requestLogger, errorLogger } = require('./middleware/logger');

const app = express();

/* -----------------------------------------------------
   SECURITY & PERFORMANCE MIDDLEWARE
------------------------------------------------------ */
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false // Configure properly in production
}));

app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

// More aggressive rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // 10 attempts per 15 minutes
  message: {
    success: false,
    message: 'Too many authentication attempts, please try again later.'
  }
});

/* -----------------------------------------------------
   CORS SETUP (supports multiple URLs)
------------------------------------------------------ */
const rawFrontendUrls = process.env.FRONTEND_URLS || 
  process.env.FRONTEND_URL || 
  'http://localhost:8080,http://localhost:5173,http://localhost:3000';

const allowedOrigins = rawFrontendUrls
  .split(',')
  .map(url => url.trim().replace(/\/$/, ''))
  .filter(Boolean);

// Add common development origins
if (process.env.NODE_ENV === 'development') {
  const devOrigins = ['http://localhost:3000', 'http://127.0.0.1:3000'];
  devOrigins.forEach(origin => {
    if (!allowedOrigins.includes(origin)) {
      allowedOrigins.push(origin);
    }
  });
}

console.log('🌐 Allowed CORS origins:', allowedOrigins);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    const cleanOrigin = origin.replace(/\/$/, '');
    
    if (allowedOrigins.includes(cleanOrigin)) {
      return callback(null, true);
    }

    // Log blocked origins in development
    if (process.env.NODE_ENV === 'development') {
      console.warn('⛔ Blocked CORS origin:', origin);
    }
    
    return callback(new Error('CORS policy blocked this request'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With', 
    'Accept',
    'X-API-Key'
  ],
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset'
  ],
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* -----------------------------------------------------
   BODY PARSING & COOKIE CONFIG
------------------------------------------------------ */
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));

app.use(cookieParser());

/* -----------------------------------------------------
   REQUEST LOGGING
------------------------------------------------------ */
app.use(requestLogger);

/* -----------------------------------------------------
   DATABASE CONNECTION WITH ENHANCED CONFIG
------------------------------------------------------ */
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

const mongooseOptions = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  bufferCommands: false,
  bufferMaxEntries: 0
};

mongoose.connect(MONGODB_URI, mongooseOptions)
  .then(async () => {
    console.log('✅ MongoDB connected successfully');
    
    // Create indexes in background
    createIndexes()
      .then(() => console.log('✅ Database indexes created/verified'))
      .catch(error => console.warn('⚠️ Index creation warnings:', error.message));
  })
  .catch((error) => {
    console.error('❌ MongoDB connection error:', error.message);
    process.exit(1);
  });

// MongoDB connection event handlers
mongoose.connection.on('error', (error) => {
  console.error('❌ MongoDB connection error:', error);
});

mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('✅ MongoDB reconnected');
});

/* -----------------------------------------------------
   ROUTE IMPORTS
------------------------------------------------------ */
const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quiz');
const folderRoutes = require('./routes/folder');
const bookmarkRoutes = require('./routes/bookmark');
const studentRoutes = require('./routes/student');
const studentQuizRoutes = require('./routes/studentQuiz');

/* -----------------------------------------------------
   ROUTE MOUNTING
------------------------------------------------------ */
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/student-quiz', studentQuizRoutes);

/* -----------------------------------------------------
   HEALTH CHECK & STATUS ENDPOINTS
------------------------------------------------------ */
app.get('/api/health', (req, res) => {
  const healthCheck = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    environment: process.env.NODE_ENV || 'development',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  };
  
  res.json(healthCheck);
});

app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

/* -----------------------------------------------------
   ERROR LOGGING MIDDLEWARE
------------------------------------------------------ */
app.use(errorLogger);

/* -----------------------------------------------------
   ERROR HANDLERS (must be last)
------------------------------------------------------ */
app.use(notFound);
app.use(errorHandler);

/* -----------------------------------------------------
   GRACEFUL SHUTDOWN HANDLING
------------------------------------------------------ */
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, starting graceful shutdown...');
  
  // Stop accepting new requests
  server.close(() => {
    console.log('✅ HTTP server closed');
    
    // Close database connection
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.log('⚠️ Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
});

process.on('SIGINT', async () => {
  console.log(' SIGINT received, shutting down...');
  process.exit(0);
});

/* -----------------------------------------------------
   UNHANDLED EXCEPTION HANDLING
------------------------------------------------------ */
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error(' Uncaught Exception:', error);
  process.exit(1);
});

/* -----------------------------------------------------
   START SERVER
------------------------------------------------------ */
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 CORS enabled for: ${allowedOrigins.length} origins`);
  console.log(`⏰ Server started at: ${new Date().toISOString()}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health\n`);
});

// Export for testing
module.exports = app;