// routes/quiz.js
const express = require('express');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const emailService = require('../services/emailService');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Constants
const ERROR_MESSAGES = {
  QUIZ_NOT_FOUND: 'Quiz not found',
  INVALID_REQUEST: 'Invalid request body',
  EMAILS_REQUIRED: 'studentEmails must be a non-empty array',
  QUIZ_ID_REQUIRED: 'quizId is required',
  SERVER_ERROR: 'Internal server error'
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FRONTEND_BASE = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
const TOKEN_BYTES = 32;

// Validation middleware
const validateQuizRequest = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.INVALID_REQUEST 
    });
  }
  next();
};

const validateShareRequest = (req, res, next) => {
  const { quizId, studentEmails } = req.body;

  if (!quizId) {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.QUIZ_ID_REQUIRED 
    });
  }

  if (!Array.isArray(studentEmails) || studentEmails.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.EMAILS_REQUIRED 
    });
  }

  next();
};

// Helper functions
const calculateMaxMarks = (questions) => {
  if (!Array.isArray(questions)) return 0;
  return questions.reduce((sum, q) => sum + (q.marks || 1), 0);
};

const sanitizeQuiz = (quiz) => ({
  id: quiz._id || quiz.id,
  title: quiz.title,
  description: quiz.description,
  questions: quiz.questions || [],
  folderId: quiz.folderId,
  userId: quiz.userId,
  settings: quiz.settings || {},
  createdAt: quiz.createdAt,
  updatedAt: quiz.updatedAt,
  numQuestions: Array.isArray(quiz.questions) ? quiz.questions.length : 0
});

const sanitizeQuizAttempt = (attempt) => ({
  id: attempt._id || attempt.id,
  studentName: attempt.studentName,
  studentUSN: attempt.studentUSN,
  studentEmail: attempt.studentEmail,
  studentBranch: attempt.studentBranch,
  studentYear: attempt.studentYear,
  studentSemester: attempt.studentSemester,
  totalMarks: attempt.totalMarks,
  maxMarks: attempt.maxMarks,
  percentage: attempt.percentage,
  status: attempt.status,
  submittedAt: attempt.submittedAt,
  answers: attempt.answers || [],
  uniqueToken: attempt.uniqueToken
});

const generateSecureToken = () => crypto.randomBytes(TOKEN_BYTES).toString('hex');

const validateEmail = (email) => {
  const trimmedEmail = String(email || '').trim().toLowerCase();
  return trimmedEmail && EMAIL_REGEX.test(trimmedEmail) ? trimmedEmail : null;
};

/**
 * GET /api/quiz/results/all
 * Get all quizzes for the current teacher with aggregated attempt statistics
 */
router.get('/results/all', protect, asyncHandler(async (req, res) => {
  const quizzes = await Quiz.find({ userId: req.user._id })
    .sort('-createdAt')
    .lean();

  const quizzesWithStats = await Promise.all(
    quizzes.map(async (quiz) => {
      const attempts = await QuizAttempt.find({
        quizId: quiz._id,
        teacherId: req.user._id
      }).lean();

      const submittedAttempts = attempts.filter(a => 
        a.status === 'submitted' || a.status === 'graded'
      );
      
      const averageScore = submittedAttempts.length > 0
        ? submittedAttempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / submittedAttempts.length
        : 0;

      return {
        ...sanitizeQuiz(quiz),
        attemptCount: attempts.length,
        submittedCount: submittedAttempts.length,
        averageScore: Math.round(averageScore * 100) / 100 // Round to 2 decimal places
      };
    })
  );

  res.json({
    success: true,
    quizzes: quizzesWithStats,
    count: quizzesWithStats.length
  });
}));

/**
 * GET /api/quiz/:id/results
 * Get quiz and attempts (teacher only)
 */
router.get('/:id/results', protect, asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ 
    _id: req.params.id, 
    userId: req.user._id 
  });

  if (!quiz) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.QUIZ_NOT_FOUND 
    });
  }

  const attempts = await QuizAttempt.find({
    quizId: req.params.id,
    teacherId: req.user._id
  })
    .sort('-submittedAt')
    .lean();

  res.json({
    success: true,
    quiz: sanitizeQuiz(quiz),
    attempts: attempts.map(sanitizeQuizAttempt),
    stats: {
      totalAttempts: attempts.length,
      submittedAttempts: attempts.filter(a => 
        a.status === 'submitted' || a.status === 'graded'
      ).length,
      averageScore: attempts.length > 0 
        ? Math.round(attempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / attempts.length * 100) / 100
        : 0
    }
  });
}));

/**
 * GET /api/quiz/:id/results/download
 * Download results as an Excel file (summary or detailed)
 * Query: ?detailed=true
 */
router.get('/:id/results/download', protect, asyncHandler(async (req, res) => {
  const quizId = req.params.id;
  const detailed = String(req.query.detailed || 'false').toLowerCase() === 'true';

  // Fetch quiz and attempts (teacher-only)
  const quiz = await Quiz.findOne({ 
    _id: quizId, 
    userId: req.user._id 
  }).lean();
  
  if (!quiz) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.QUIZ_NOT_FOUND 
    });
  }

  const attempts = await QuizAttempt.find({ 
    quizId: quizId, 
    teacherId: req.user._id 
  })
    .sort('-submittedAt')
    .lean();

  // Build workbook
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Results');

  // Header row
  const header = [
    { header: 'Student Name', key: 'studentName', width: 30 },
    { header: 'USN', key: 'studentUSN', width: 18 },
    { header: 'Email', key: 'studentEmail', width: 30 },
    { header: 'Branch', key: 'studentBranch', width: 18 },
    { header: 'Year', key: 'studentYear', width: 10 },
    { header: 'Semester', key: 'studentSemester', width: 10 },
    { header: 'Total Marks', key: 'totalMarks', width: 14 },
    { header: 'Max Marks', key: 'maxMarks', width: 12 },
    { header: 'Percentage', key: 'percentage', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Submitted At', key: 'submittedAt', width: 22 }
  ];

  // If detailed, add columns for question-by-question
  if (detailed && Array.isArray(quiz.questions) && quiz.questions.length > 0) {
    quiz.questions.forEach((q, idx) => {
      header.push({ 
        header: `Q${idx + 1} (${q.marks || 1} marks)`, 
        key: `q_${idx + 1}`, 
        width: 18 
      });
    });
  }

  sheet.columns = header;

  // Add data rows
  attempts.forEach(a => {
    const row = {
      studentName: a.studentName || 'N/A',
      studentUSN: a.studentUSN || 'N/A',
      studentEmail: a.studentEmail || 'N/A',
      studentBranch: a.studentBranch || 'N/A',
      studentYear: a.studentYear || 'N/A',
      studentSemester: a.studentSemester || 'N/A',
      totalMarks: (a.totalMarks !== undefined && a.totalMarks !== null) ? a.totalMarks : 0,
      maxMarks: (a.maxMarks !== undefined && a.maxMarks !== null) ? a.maxMarks : 0,
      percentage: (a.percentage !== undefined && a.percentage !== null) 
        ? Math.round(a.percentage * 100) / 100 
        : 0,
      status: a.status || 'not submitted',
      submittedAt: a.submittedAt ? new Date(a.submittedAt).toLocaleString() : 'Not submitted'
    };

    if (detailed && Array.isArray(a.answers)) {
      quiz.questions.forEach((_, idx) => {
        const ans = a.answers && a.answers[idx] ? a.answers[idx].studentAnswer : '';
        row[`q_${idx + 1}`] = ans;
      });
    }

    sheet.addRow(row);
  });

  // Style header row
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE6E6FA' }
  };

  // Set response headers for download
  const safeTitle = (quiz.title || 'quiz').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const filename = `${safeTitle}_results${detailed ? '_detailed' : ''}_${Date.now()}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', (await workbook.xlsx.getBuffer()).length);

  // Stream workbook to response
  await workbook.xlsx.write(res);
  res.end();
}));

/**
 * GET /api/quiz/all
 * List teacher quizzes with pagination
 */
router.get('/all', protect, asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 50, 
    folderId,
    search,
    sortBy = '-createdAt' 
  } = req.query;

  // Build query
  const query = { userId: req.user._id };
  
  if (folderId) {
    query.folderId = folderId;
  }
  
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } }
    ];
  }

  const quizzes = await Quiz.find(query)
    .populate('folderId', 'name color')
    .sort(sortBy)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Quiz.countDocuments(query);

  res.json({
    success: true,
    quizzes: quizzes.map(sanitizeQuiz),
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

/**
 * POST /api/quiz/save
 * Create a new quiz
 */
router.post('/save', protect, validateQuizRequest, asyncHandler(async (req, res) => {
  const { title, questions, description, folderId, settings } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ 
      success: false, 
      message: 'Quiz title is required' 
    });
  }

  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'Quiz must have at least one question' 
    });
  }

  const quiz = await Quiz.create({
    title: title.trim(),
    description: description ? description.trim() : '',
    questions: questions.map(q => ({
      ...q,
      questionText: q.questionText?.trim() || '',
      options: Array.isArray(q.options) ? q.options.map(opt => opt?.trim() || '') : []
    })),
    folderId: folderId || null,
    settings: settings || {},
    userId: req.user._id,
    maxMarks: calculateMaxMarks(questions)
  });

  res.status(201).json({
    success: true,
    quizId: quiz._id,
    quiz: sanitizeQuiz(quiz)
  });
}));

/**
 * PUT /api/quiz/:id
 * Update an existing quiz
 */
router.put('/:id', protect, validateQuizRequest, asyncHandler(async (req, res) => {
  const { title, questions, description, folderId, settings } = req.body;

  const quiz = await Quiz.findOne({ 
    _id: req.params.id, 
    userId: req.user._id 
  });

  if (!quiz) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.QUIZ_NOT_FOUND 
    });
  }

  // Build update object
  const updateData = {};
  if (title !== undefined) updateData.title = title.trim();
  if (description !== undefined) updateData.description = description.trim();
  if (folderId !== undefined) updateData.folderId = folderId;
  if (settings !== undefined) updateData.settings = settings;
  
  if (Array.isArray(questions)) {
    updateData.questions = questions.map(q => ({
      ...q,
      questionText: q.questionText?.trim() || '',
      options: Array.isArray(q.options) ? q.options.map(opt => opt?.trim() || '') : []
    }));
    updateData.maxMarks = calculateMaxMarks(questions);
  }

  const updatedQuiz = await Quiz.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    updateData,
    { new: true, runValidators: true }
  ).populate('folderId');

  res.json({
    success: true,
    quiz: sanitizeQuiz(updatedQuiz)
  });
}));

/**
 * POST /api/quiz/share
 * Share quiz with students via email
 */
router.post('/share', protect, validateShareRequest, asyncHandler(async (req, res) => {
  const { quizId, studentEmails } = req.body;

  const quiz = await Quiz.findOne({ 
    _id: quizId, 
    userId: req.user._id 
  });

  if (!quiz) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.QUIZ_NOT_FOUND 
    });
  }

  // Verify email service connection
  const emailReady = await emailService.verifyConnection().catch(() => false);
  if (!emailReady) {
    console.warn('Email service not ready; emails may fail to send');
  }

  const sent = [];
  const failed = [];
  const invalid = [];
  const alreadySent = [];

  // Process emails with rate limiting consideration
  for (const rawEmail of studentEmails) {
    const email = validateEmail(rawEmail);
    
    if (!email) {
      invalid.push({ email: rawEmail, reason: 'Invalid email format' });
      continue;
    }

    // Check for existing attempt
    let attempt = await QuizAttempt.findOne({ 
      quizId: quiz._id, 
      studentEmail: email 
    });

    if (attempt && attempt.emailSent) {
      alreadySent.push({ 
        email, 
        link: `${FRONTEND_BASE}/quiz/attempt/${attempt.uniqueToken}`,
        token: attempt.uniqueToken 
      });
      continue;
    }

    // Create new attempt if needed
    if (!attempt) {
      const token = generateSecureToken();
      
      attempt = new QuizAttempt({
        quizId: quiz._id,
        teacherId: req.user._id,
        studentEmail: email,
        uniqueToken: token,
        emailSent: false,
        maxMarks: calculateMaxMarks(quiz.questions),
        status: 'invited'
      });

      try {
        await attempt.save();
      } catch (saveErr) {
        failed.push({ 
          email, 
          reason: `Failed to create attempt: ${saveErr.message}` 
        });
        continue;
      }
    }

    const uniqueLink = `${FRONTEND_BASE}/quiz/attempt/${attempt.uniqueToken}`;

    // Send email
    try {
      const sendRes = await emailService.sendQuizInvitation(
        email,
        quiz.title || 'Untitled Quiz',
        uniqueLink,
        req.user.name || 'Teacher'
      );

      if (sendRes && sendRes.success) {
        attempt.emailSent = true;
        attempt.sentAt = new Date();
        await attempt.save();
        
        sent.push({ 
          email, 
          link: uniqueLink, 
          token: attempt.uniqueToken 
        });
      } else {
        const reason = sendRes?.error || sendRes?.message || 'Unknown send error';
        failed.push({ email, reason });
      }
    } catch (err) {
      failed.push({ 
        email, 
        reason: err.message || 'Email sending failed' 
      });
    }
  }

  const response = {
    success: true,
    message: `Quiz links sent to ${sent.length} student(s)`,
    links: sent,
    alreadySent,
    failed,
    invalid,
    summary: {
      total: studentEmails.length,
      sent: sent.length,
      alreadySent: alreadySent.length,
      failed: failed.length,
      invalid: invalid.length
    }
  };

  // If nothing was sent successfully, return 207 (Multi-Status) instead of error
  if (sent.length === 0 && alreadySent.length === 0) {
    return res.status(207).json(response);
  }

  res.json(response);
}));

/**
 * GET /api/quiz/:id
 * Fetch a single quiz (teacher only)
 */
router.get('/:id', protect, asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ 
    _id: req.params.id, 
    userId: req.user._id 
  }).populate('folderId');

  if (!quiz) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.QUIZ_NOT_FOUND 
    });
  }

  res.json({
    success: true,
    quiz: sanitizeQuiz(quiz)
  });
}));

/**
 * DELETE /api/quiz/:id
 * Delete a quiz and its attempts
 */
router.delete('/:id', protect, asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ 
    _id: req.params.id, 
    userId: req.user._id 
  });

  if (!quiz) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.QUIZ_NOT_FOUND 
    });
  }

  // Delete all attempts for this quiz
  await QuizAttempt.deleteMany({ 
    quizId: req.params.id,
    teacherId: req.user._id 
  });

  // Delete the quiz
  await Quiz.findByIdAndDelete(req.params.id);

  res.json({
    success: true,
    message: 'Quiz and all associated attempts deleted successfully',
    deletedId: req.params.id
  });
}));

// Health check endpoint
router.get('/health', protect, (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Quiz service is healthy',
    timestamp: new Date().toISOString(),
    userId: req.user._id
  });
});

module.exports = router;