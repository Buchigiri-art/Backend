# Quiz Generator Backend

Professional Node.js/Express backend with MongoDB for the Quiz Generator application.

## Features

- 🔐 **JWT Authentication** with HTTP-only cookies
- 🔒 **Enterprise Security**:
  - Password hashing with bcrypt
  - Rate limiting on login endpoints
  - Input validation and sanitization
  - MongoDB indexes for performance
- 👥 **User Management** (Faculty/Teacher accounts)
- 📝 **Quiz Operations** (Create, Read, Update, Delete)
- 🎯 **Student Quiz System**:
  - Email-based quiz sharing with unique links
  - Auto-grading with Gemini AI
  - Excel report generation
  - Real-time timer and progress tracking
- 📊 **Results & Analytics**:
  - Detailed student performance tracking
  - Excel export (summary & detailed)
  - Statistical analysis
- 📚 **Folder Organization** for quizzes
- 🔖 **Question Bookmarking**
- 👨‍🎓 **Student Management**
- 📧 **Email Service** for quiz invitations
- 🌐 **CORS** enabled for frontend integration

## Setup Instructions

1. **Set Up MongoDB Atlas (Cloud Database)**
   - Create a free account at: https://www.mongodb.com/cloud/atlas/register
   - Create a new cluster (M0 Sandbox - Free tier)
   - Click "Connect" and select "Connect your application"
   - Copy the connection string
   
   **Database Configuration:**
   - Database name: `smartquiz`
   - Create a database user with username and password
   - Whitelist IP addresses:
     - Development: Add your current IP or use `0.0.0.0/0` (all IPs)
     - Production: Add your server's IP address only
   
   **Security Best Practices:**
   - Use strong, unique passwords for database users
   - Never commit database credentials to version control
   - Enable MongoDB Atlas audit logs in production
   - Set up automated backups (available in paid tiers)

2. **Install Dependencies**
   ```bash
   cd backend
   npm install
   ```

3. **Configure Environment**
   ```bash
   cp .env.example .env
   ```
   - Update `MONGODB_URI` with your MongoDB Atlas connection string
   - Format: `mongodb+srv://<username>:<password>@<cluster>.mongodb.net/smartquiz?retryWrites=true&w=majority`
   - **Set a strong JWT_SECRET** (use a random 64+ character string)
   - Configure `EMAIL_USER` and `EMAIL_PASSWORD` (Gmail App Password)
   - Add your `GEMINI_API_KEY` for auto-grading
   - Set `FRONTEND_URL` to your frontend URL

4. **Start the Server**
   ```bash
   # Development mode
   npm run dev

   # Production mode
   npm start
   ```

5. **Verify MongoDB Atlas Connection**
   - Check server logs for "MongoDB connected successfully"
   - View your data in MongoDB Atlas dashboard
   - Database name: `smartquiz`
   - Collections will be created automatically on first use

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user (protected)

### Quizzes
- `GET /api/quiz/all` - Get all quizzes
- `GET /api/quiz/:id` - Get quiz by ID
- `POST /api/quiz/save` - Create new quiz
- `PUT /api/quiz/:id` - Update quiz
- `DELETE /api/quiz/:id` - Delete quiz
- `POST /api/quiz/share` - Share quiz with students

### Folders
- `GET /api/folders` - Get all folders
- `POST /api/folders` - Create folder
- `PUT /api/folders/:id` - Update folder
- `DELETE /api/folders/:id` - Delete folder

### Bookmarks
- `GET /api/bookmarks` - Get all bookmarks
- `POST /api/bookmarks` - Create bookmark
- `DELETE /api/bookmarks/:id` - Delete bookmark

### Students
- `GET /api/students/all` - Get all students
- `POST /api/students/upload` - Upload students
- `DELETE /api/students/:id` - Delete student

## Database Models

- **User**: Faculty/Admin users with secure password storage
- **Quiz**: Quiz data with questions (scoped to userId)
- **Folder**: Organization folders for quizzes/bookmarks (scoped to userId)
- **Bookmark**: Saved questions (scoped to userId)
- **Student**: Student records (scoped to userId)

## 🔐 Security Implementation Details

### Password Requirements
- Minimum 8 characters
- At least 1 uppercase letter (A-Z)
- At least 1 lowercase letter (a-z)
- At least 1 number (0-9)
- Hashed with bcrypt (12 rounds)

### Rate Limiting
- Maximum 5 login attempts per IP address
- 15-minute lockout after exceeding limit
- Automatic cleanup of expired attempts

### Authentication Flow
1. User logs in with email/password
2. Server validates credentials
3. JWT token generated and sent as HTTP-only cookie
4. Token automatically included in all subsequent requests
5. Server verifies token on protected routes
6. User data scoped to authenticated userId

### Data Protection
- All API endpoints require valid JWT token
- Database queries automatically filter by req.user._id
- No cross-user data access possible
- Passwords never exposed in API responses

## Architecture

```
backend/
├── models/              # MongoDB schemas
│   ├── User.js         # User authentication
│   ├── Quiz.js         # Quiz data
│   ├── Student.js      # Student records
│   ├── Folder.js       # Organization folders
│   └── Bookmark.js     # Saved questions
├── routes/              # API endpoints
│   ├── auth.js         # Authentication routes
│   ├── quiz.js         # Quiz management
│   ├── student.js      # Student management
│   ├── folder.js       # Folder operations
│   └── bookmark.js     # Bookmark operations
├── middleware/          # Request processing
│   ├── auth.js         # JWT verification
│   ├── validation.js   # Input validation & rate limiting
│   └── errorHandler.js # Global error handling
├── config/             
│   └── dbIndexes.js    # Database performance optimization
└── server.js           # Main application entry
```

## Production Checklist

### Security
- [ ] Set strong JWT_SECRET (64+ random characters)
- [ ] Use strong MongoDB Atlas user passwords
- [ ] Restrict MongoDB Atlas IP whitelist to production server only
- [ ] Enable MongoDB Atlas network peering (for enhanced security)
- [ ] Set NODE_ENV=production
- [ ] Configure CORS for production domain only
- [ ] Use HTTPS in production
- [ ] Enable MongoDB Atlas encryption at rest

### Monitoring & Backup
- [ ] Enable MongoDB Atlas automated backups
- [ ] Set up MongoDB Atlas monitoring and alerts
- [ ] Configure log retention policies
- [ ] Monitor rate limit logs
- [ ] Set up error logging service (Sentry, LogRocket, etc.)
- [ ] Enable MongoDB Atlas performance advisor

### Performance
- [ ] Review and optimize database indexes
- [ ] Enable MongoDB Atlas auto-scaling (if needed)
- [ ] Configure connection pooling
- [ ] Set up CDN for static assets
- [ ] Implement API response caching where appropriate
