const express = require('express');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Constants
const ERROR_MESSAGES = {
  TOKEN_REQUIRED: 'Token is required',
  INVALID_TOKEN: 'Invalid or expired quiz link',
  QUIZ_NOT_FOUND: 'Quiz not found',
  ALREADY_SUBMITTED: 'This quiz has already been submitted',
  ALL_FIELDS_REQUIRED: 'All student fields are required',
  ATTEMPT_NOT_FOUND: 'Attempt not found',
  SERVER_ERROR: 'Internal server error'
};

const WARNING_THRESHOLD = 4;

// Validation middleware
const validateToken = (req, res, next) => {
  const { token } = req.params;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.TOKEN_REQUIRED 
    });
  }
  next();
};

const validateStartAttempt = (req, res, next) => {
  const { token, studentName, studentUSN, studentBranch, studentYear, studentSemester } = req.body;

  if (!token || !studentName?.trim() || !studentUSN?.trim() || 
      !studentBranch?.trim() || !studentYear || !studentSemester) {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.ALL_FIELDS_REQUIRED 
    });
  }
  next();
};

const validateSubmitAttempt = (req, res, next) => {
  const { attemptId, answers } = req.body;

  if (!attemptId || !Array.isArray(answers)) {
    return res.status(400).json({ 
      success: false, 
      message: 'attemptId and answers array are required' 
    });
  }
  next();
};

// Helper functions
const sanitizeQuizForStudent = (quiz) => ({
  id: quiz._id || quiz.id,
  title: quiz.title,
  description: quiz.description,
  duration: quiz.duration || 30,
  questions: (quiz.questions || []).map(q => ({
    id: q.id || q._id,
    type: q.type || 'mcq',
    question: q.question || q.questionText,
    options: q.options || [],
    marks: q.marks || 1
    // Don't include correct answer
  }))
});

const sanitizeAttempt = (attempt) => ({
  attemptId: attempt._id,
  studentInfo: {
    name: attempt.studentName || '',
    usn: attempt.studentUSN || '',
    email: attempt.studentEmail || '',
    branch: attempt.studentBranch || '',
    year: attempt.studentYear || '',
    semester: attempt.studentSemester || ''
  },
  status: attempt.status,
  warningCount: attempt.warningCount || 0,
  isCheated: attempt.isCheated || false,
  startedAt: attempt.startedAt,
  submittedAt: attempt.submittedAt
});

const calculateMaxMarks = (questions) => {
  if (!Array.isArray(questions)) return 0;
  return questions.reduce((sum, q) => sum + (q.marks || 1), 0);
};

const gradeQuiz = (quizQuestions, studentAnswers) => {
  let totalMarks = 0;
  const maxMarks = calculateMaxMarks(quizQuestions);
  const gradedAnswers = [];

  for (let i = 0; i < quizQuestions.length; i++) {
    const question = quizQuestions[i];
    const studentAnswer = studentAnswers[i] ?? '';
    const marks = question.marks || 1;
    let isCorrect = false;

    // Only grade if correct answer exists
    if (question.answer !== undefined && question.answer !== null) {
      const correctAnswer = String(question.answer).trim().toLowerCase();
      const givenAnswer = String(studentAnswer).trim().toLowerCase();
      
      isCorrect = correctAnswer === givenAnswer;
      if (isCorrect) {
        totalMarks += marks;
      }
    }

    gradedAnswers.push({
      questionId: question.id || question._id,
      question: question.question || question.questionText,
      type: question.type || 'mcq',
      options: question.options || [],
      studentAnswer,
      correctAnswer: question.answer,
      isCorrect,
      marks
    });
  }

  const percentage = maxMarks > 0 ? Number(((totalMarks / maxMarks) * 100).toFixed(2)) : 0;

  return { totalMarks, maxMarks, percentage, gradedAnswers };
};

/**
 * GET /api/student-quiz/attempt/:token
 * Get quiz attempt data for student
 */
router.get('/attempt/:token', validateToken, asyncHandler(async (req, res) => {
  const { token } = req.params;

  const attempt = await QuizAttempt.findOne({ uniqueToken: token })
    .populate('quizId')
    .lean();

  if (!attempt) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.INVALID_TOKEN 
    });
  }

  // Check if already submitted
  if (attempt.status === 'submitted' || attempt.status === 'graded') {
    return res.json({
      success: false,
      alreadySubmitted: true,
      message: ERROR_MESSAGES.ALREADY_SUBMITTED,
      results: {
        totalMarks: attempt.totalMarks,
        maxMarks: attempt.maxMarks,
        percentage: attempt.percentage
      }
    });
  }

  const quiz = attempt.quizId;
  if (!quiz) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.QUIZ_NOT_FOUND 
    });
  }

  res.json({
    success: true,
    quiz: sanitizeQuizForStudent(quiz),
    ...sanitizeAttempt(attempt),
    hasStarted: attempt.status === 'started'
  });
}));

/**
 * POST /api/student-quiz/attempt/start
 * Start a quiz attempt
 */
router.post('/attempt/start', validateStartAttempt, asyncHandler(async (req, res) => {
  const { token, studentName, studentUSN, studentBranch, studentYear, studentSemester } = req.body;

  const attempt = await QuizAttempt.findOne({ uniqueToken: token });
  if (!attempt) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.INVALID_TOKEN 
    });
  }

  if (attempt.status === 'submitted' || attempt.status === 'graded') {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.ALREADY_SUBMITTED 
    });
  }

  // Update student info and start attempt
  attempt.studentName = studentName.trim();
  attempt.studentUSN = studentUSN.trim().toUpperCase();
  attempt.studentBranch = studentBranch.trim();
  attempt.studentYear = studentYear;
  attempt.studentSemester = studentSemester;
  attempt.status = 'started';
  attempt.startedAt = new Date();

  await attempt.save();

  const quiz = await Quiz.findById(attempt.quizId).lean();
  if (!quiz) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.QUIZ_NOT_FOUND 
    });
  }

  res.json({
    success: true,
    quiz: sanitizeQuizForStudent(quiz),
    ...sanitizeAttempt(attempt)
  });
}));

/**
 * POST /api/student-quiz/attempt/flag
 * Flag suspicious activity during quiz
 */
router.post('/attempt/flag', asyncHandler(async (req, res) => {
  const { token, reason } = req.body;

  if (!token) {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.TOKEN_REQUIRED 
    });
  }

  const attempt = await QuizAttempt.findOne({ uniqueToken: token }).populate('quizId');
  if (!attempt) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.INVALID_TOKEN 
    });
  }

  if (attempt.status === 'submitted' || attempt.status === 'graded') {
    return res.status(400).json({ 
      success: false, 
      message: 'Attempt already submitted' 
    });
  }

  // Increment warning and log
  attempt.warningCount = (attempt.warningCount || 0) + 1;
  attempt.lastWarningAt = new Date();
  
  if (!attempt.cheatLogs) attempt.cheatLogs = [];
  attempt.cheatLogs.push({
    at: new Date(),
    reason: reason || 'Suspicious activity detected'
  });

  let autoSubmitted = false;

  // Auto-submit if threshold reached
  if (attempt.warningCount >= WARNING_THRESHOLD) {
    attempt.isCheated = true;
    attempt.status = 'submitted';
    attempt.submittedAt = new Date();
    attempt.gradedAt = new Date();

    const maxMarks = calculateMaxMarks(attempt.quizId?.questions);
    attempt.totalMarks = 0;
    attempt.maxMarks = maxMarks;
    attempt.percentage = 0;

    autoSubmitted = true;
  }

  await attempt.save();

  res.json({
    success: true,
    warningCount: attempt.warningCount,
    autoSubmitted,
    message: autoSubmitted 
      ? 'Quiz auto-submitted due to repeated violations' 
      : 'Warning logged'
  });
}));

/**
 * POST /api/student-quiz/attempt/submit
 * Submit quiz attempt
 */
router.post('/attempt/submit', validateSubmitAttempt, asyncHandler(async (req, res) => {
  const { attemptId, answers } = req.body;

  const attempt = await QuizAttempt.findById(attemptId).populate('quizId');
  if (!attempt) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.ATTEMPT_NOT_FOUND 
    });
  }

  if (attempt.status === 'submitted' || attempt.status === 'graded') {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.ALREADY_SUBMITTED 
    });
  }

  const quiz = attempt.quizId;
  if (!quiz) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.QUIZ_NOT_FOUND 
    });
  }

  // Grade the quiz
  const { totalMarks, maxMarks, percentage, gradedAnswers } = gradeQuiz(
    quiz.questions || [],
    answers
  );

  // Update attempt
  attempt.answers = gradedAnswers;
  attempt.totalMarks = totalMarks;
  attempt.maxMarks = maxMarks;
  attempt.percentage = percentage;
  attempt.status = 'graded';
  attempt.submittedAt = new Date();
  attempt.gradedAt = new Date();

  await attempt.save();

  res.json({
    success: true,
    message: 'Quiz submitted successfully',
    results: {
      totalMarks,
      maxMarks,
      percentage,
      gradedAnswers: gradedAnswers.map(a => ({
        question: a.question,
        studentAnswer: a.studentAnswer,
        correctAnswer: a.correctAnswer,
        isCorrect: a.isCorrect,
        marks: a.marks
      }))
    }
  });
}));

/**
 * GET /api/student-quiz/attempt/:token/results
 * Get quiz results after submission
 */
router.get('/attempt/:token/results', validateToken, asyncHandler(async (req, res) => {
  const { token } = req.params;

  const attempt = await QuizAttempt.findOne({ uniqueToken: token })
    .populate('quizId')
    .lean();

  if (!attempt) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.INVALID_TOKEN 
    });
  }

  if (attempt.status !== 'submitted' && attempt.status !== 'graded') {
    return res.status(400).json({ 
      success: false, 
      message: 'Quiz results not available yet' 
    });
  }

  res.json({
    success: true,
    quiz: attempt.quizId ? {
      title: attempt.quizId.title,
      description: attempt.quizId.description
    } : null,
    ...sanitizeAttempt(attempt),
    results: {
      totalMarks: attempt.totalMarks,
      maxMarks: attempt.maxMarks,
      percentage: attempt.percentage,
      answers: attempt.answers || []
    }
  });
}));

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Student Quiz service is healthy',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;