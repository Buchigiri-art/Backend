const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const cookieParser = require('cookie-parser');

const { errorHandler, notFound } = require('./middleware/errorHandler');
const { createIndexes } = require('./config/dbIndexes');

const app = express();

/* -----------------------------------------------------
   BASIC SECURITY HEADERS
------------------------------------------------------ */
app.use((req, res, next) => {
  // Basic security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

/* -----------------------------------------------------
   SIMPLE RATE LIMITING
------------------------------------------------------ */
const rateLimitMap = new Map();

const rateLimitMiddleware = (req, res, next) => {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxRequests = 1000;
  const ip = req.ip || req.connection.remoteAddress;

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, { count: 1, startTime: now });
    return next();
  }

  const ipData = rateLimitMap.get(ip);
  
  if (now - ipData.startTime > windowMs) {
    ipData.count = 1;
    ipData.startTime = now;
    return next();
  }

  if (ipData.count >= maxRequests) {
    return res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later.'
    });
  }

  ipData.count++;
  next();
};

// Clean up old entries every hour
setInterval(() => {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  for (const [ip, data] of rateLimitMap.entries()) {
    if (now - data.startTime > windowMs) {
      rateLimitMap.delete(ip);
    }
  }
}, 60 * 60 * 1000);

app.use(rateLimitMiddleware);

/* -----------------------------------------------------
   CORS SETUP
------------------------------------------------------ */
const rawFrontendUrls = process.env.FRONTEND_URLS || 
  process.env.FRONTEND_URL || 
  'http://localhost:8080,http://localhost:5173,http://localhost:3000';

const allowedOrigins = rawFrontendUrls
  .split(',')
  .map(url => url.trim().replace(/\/$/, ''))
  .filter(Boolean);

console.log('🌐 Allowed CORS origins:', allowedOrigins);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    
    const cleanOrigin = origin.replace(/\/$/, '');
    
    if (allowedOrigins.includes(cleanOrigin)) {
      return callback(null, true);
    }

    if (process.env.NODE_ENV === 'development') {
      console.warn('⛔ Blocked CORS origin:', origin);
    }
    
    return callback(new Error('CORS policy blocked this request'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* -----------------------------------------------------
   BODY PARSING & COOKIE CONFIG
------------------------------------------------------ */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

/* -----------------------------------------------------
   REQUEST LOGGING
------------------------------------------------------ */
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});

/* -----------------------------------------------------
   DATABASE CONNECTION (FIXED)
------------------------------------------------------ */
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

// Fixed MongoDB connection options
const mongooseOptions = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  // Remove deprecated options
};

console.log('🔗 Connecting to MongoDB...');

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
    console.error('💡 Please check your MONGODB_URI and ensure MongoDB is running');
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
app.use('/api/auth', authRoutes);
app.use('/api/quiz', quizRoutes);
app.use('/api/folders', folderRoutes);
app.use('/api/bookmarks', bookmarkRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/student-quiz', studentQuizRoutes);

/* -----------------------------------------------------
   HEALTH CHECK ENDPOINTS
------------------------------------------------------ */
app.get('/api/health', (req, res) => {
  const healthCheck = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  };
  
  res.json(healthCheck);
});

app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Quiz API Server',
    version: '1.0.0',
    status: 'running'
  });
});

/* -----------------------------------------------------
   ERROR HANDLERS
------------------------------------------------------ */
app.use(notFound);
app.use(errorHandler);

/* -----------------------------------------------------
   GRACEFUL SHUTDOWN
------------------------------------------------------ */
const gracefulShutdown = (signal) => {
  console.log(`\n🛑 ${signal} received, starting graceful shutdown...`);
  
  server.close(() => {
    console.log('✅ HTTP server closed');
    
    mongoose.connection.close(false, () => {
      console.log('✅ MongoDB connection closed');
      process.exit(0);
    });
  });
  
  setTimeout(() => {
    console.log('⚠️ Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/* -----------------------------------------------------
   UNHANDLED EXCEPTION HANDLING
------------------------------------------------------ */
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
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
  console.log(`🔗 Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;