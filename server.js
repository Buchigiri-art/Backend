// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const cookieParser = require('cookie-parser');

const { errorHandler, notFound } = require('./middleware/errorHandler');
const { createIndexes } = require('./config/dbIndexes');

const app = express();

/* -----------------------------------------------------
   CORS SETUP (supports multiple URLs)
------------------------------------------------------ */
const rawFrontendUrls =
  process.env.FRONTEND_URLS ||
  process.env.FRONTEND_URL ||
  'http://localhost:8080,http://localhost:5173';

const allowedOrigins = rawFrontendUrls
  .split(',')
  .map((url) => url.trim().replace(/\/$/, ''))
  .filter(Boolean);

console.log('Allowed CORS origins:', allowedOrigins);

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Postman, curl allowed
    const cleanOrigin = origin.replace(/\/$/, '');

    if (allowedOrigins.includes(cleanOrigin)) {
      return callback(null, true);
    }

    console.warn('⛔ Blocked CORS origin:', origin);
    return callback(new Error('CORS blocked for: ' + origin), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

/* -----------------------------------------------------
   CONNECT TO MONGODB
------------------------------------------------------ */
mongoose
  .connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('MongoDB connected successfully');
    try {
      await createIndexes();
    } catch (e) {
      console.warn('⚠ Index creation failed:', e);
    }
  })
  .catch((err) => console.error('❌ MongoDB connection error:', err));

/* -----------------------------------------------------
   ROUTE IMPORTS (Direct, no try/catch needed)
------------------------------------------------------ */
const authRoutes = require('./routes/auth');
const quizRoutes = require('./routes/quiz'); // <-- Now contains fixed ordering!
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
   HEALTHCHECK
------------------------------------------------------ */
app.get('/api/health', (req, res) =>
  res.json({ status: 'OK', message: 'Server is running' })
);

/* -----------------------------------------------------
   ERROR HANDLERS (must be last)
------------------------------------------------------ */
app.use(notFound);      // 404 handler
app.use(errorHandler);  // custom error middleware

/* -----------------------------------------------------
   START SERVER
------------------------------------------------------ */
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
