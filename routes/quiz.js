// routes/quiz.js
const express = require('express');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const emailService = require('../services/emailService');
const { protect } = require('../middleware/auth');

const router = express.Router();

/**
 * ROUTE ORDER MATTERS:
 * 1) /results/all
 * 2) /:id/results/:attemptId
 * 3) /:id/results
 * 4) other specific route (e.g. /all, /save, /share, /:id/results/download)
 * 5) /:id  <-- MUST BE LAST
 */

/**
 * GET /api/quiz/results/all
 * Get all quizzes for the current teacher with aggregated attempt statistics
 */
router.get('/results/all', protect, async (req, res) => {
  try {
    const QuizAttemptModel = require('../models/QuizAttempt');
    const quizzes = await Quiz.find({ userId: req.user._id }).sort('-createdAt').lean();

    const quizzesWithStats = await Promise.all(
      quizzes.map(async (quiz) => {
        const attempts = await QuizAttemptModel.find({
          quizId: quiz._id,
          teacherId: req.user._id
        });

        const submittedAttempts = attempts.filter(a => a.status === 'submitted' || a.status === 'graded');
        const averageScore = submittedAttempts.length > 0
          ? submittedAttempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / submittedAttempts.length
          : 0;

        return {
          ...quiz,
          attemptCount: attempts.length,
          submittedCount: submittedAttempts.length,
          averageScore
        };
      })
    );

    res.json(quizzesWithStats);
  } catch (error) {
    console.error('GET /results/all error:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch results' });
  }
});

/**
 * ✅ NEW: GET /api/quiz/:id/results/:attemptId
 * Get a single student's attempt with all answers (teacher only)
 */
router.get('/:id/results/:attemptId', protect, async (req, res) => {
  try {
    const { id: quizId, attemptId } = req.params;

    // Ensure the attempt belongs to this teacher & quiz
    const attempt = await QuizAttempt.findOne({
      _id: attemptId,
      quizId: quizId,
      teacherId: req.user._id,
    }).lean();

    if (!attempt) {
      return res.status(404).json({ success: false, message: 'Attempt not found' });
    }

    // Map answers into a nicer "questions" array for frontend
    const questions = (attempt.answers || []).map((a) => {
      const options = Array.isArray(a.options) ? a.options : [];
      const studentAnswer = a.studentAnswer || '';
      const correctAnswer = a.correctAnswer || '';

      const selectedOptionIndex = options.length
        ? options.indexOf(studentAnswer)
        : -1;

      const correctOptionIndex = options.length
        ? options.indexOf(correctAnswer)
        : -1;

      return {
        _id: a.questionId || undefined,
        questionText: a.question || '',
        type: a.type || 'short-answer',
        options,
        studentAnswer,
        correctAnswer,
        isCorrect: !!a.isCorrect,
        marks: a.marks ?? 0,
        explanation: a.explanation || '',
        selectedOptionIndex,
        correctOptionIndex,
      };
    });

    const response = {
      _id: attempt._id,
      quizId: attempt.quizId,
      teacherId: attempt.teacherId,
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
      startedAt: attempt.startedAt,
      gradedAt: attempt.gradedAt,
      questions,
    };

    return res.json({ success: true, attempt: response });
  } catch (error) {
    console.error(`GET /${req.params.id}/results/${req.params.attemptId} error:`, error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch attempt detail' });
  }
});

/**
 * GET /api/quiz/:id/results
 * Get quiz and attempts (teacher only)
 */
router.get('/:id/results', protect, async (req, res) => {
  try {
    const QuizAttemptModel = require('../models/QuizAttempt');
    const quiz = await Quiz.findOne({ _id: req.params.id, userId: req.user._id });

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const attempts = await QuizAttemptModel.find({
      quizId: req.params.id,
      teacherId: req.user._id
    }).sort('-submittedAt');

    res.json({
      success: true,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        numQuestions: Array.isArray(quiz.questions) ? quiz.questions.length : 0
      },
      attempts
    });
  } catch (error) {
    console.error(`GET /${req.params.id}/results error:`, error);
    res.status(500).json({ message: error.message || 'Failed to fetch attempts' });
  }
});

/**
 * GET /api/quiz/:id/results/download
 * Download results as an Excel file (summary or detailed)
 * Query: ?detailed=true
 */
router.get('/:id/results/download', protect, async (req, res) => {
  try {
    const quizId = req.params.id;
    const detailed = String(req.query.detailed || 'false').toLowerCase() === 'true';

    // fetch quiz and attempts (teacher-only)
    const quiz = await Quiz.findOne({ _id: quizId, userId: req.user._id }).lean();
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    const attempts = await QuizAttempt.find({ quizId: quizId, teacherId: req.user._id })
      .sort('-submittedAt')
      .lean();

    // build workbook
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

    // If detailed, add columns for question-by-question (if quiz.questions exists)
    if (detailed && Array.isArray(quiz.questions) && quiz.questions.length > 0) {
      quiz.questions.forEach((q, idx) => {
        header.push({ header: `Q${idx + 1}`, key: `q_${idx + 1}`, width: 18 });
      });
    }

    sheet.columns = header;

    // Rows
    for (const a of attempts) {
      const row = {
        studentName: a.studentName || '',
        studentUSN: a.studentUSN || '',
        studentEmail: a.studentEmail || '',
        studentBranch: a.studentBranch || '',
        studentYear: a.studentYear || '',
        studentSemester: a.studentSemester || '',
        totalMarks: (a.totalMarks !== undefined && a.totalMarks !== null) ? a.totalMarks : '',
        maxMarks: (a.maxMarks !== undefined && a.maxMarks !== null) ? a.maxMarks : '',
        percentage: (a.percentage !== undefined && a.percentage !== null) ? a.percentage : '',
        status: a.status || '',
        submittedAt: a.submittedAt ? new Date(a.submittedAt).toLocaleString() : ''
      };

      if (detailed && Array.isArray(a.answers)) {
        for (let i = 0; i < quiz.questions.length; i++) {
          const ans = (a.answers && a.answers[i]) ? a.answers[i].studentAnswer : '';
          row[`q_${i + 1}`] = ans;
        }
      }

      sheet.addRow(row);
    }

    // set response headers to download
    const safeTitle = (quiz.title || 'quiz').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `${safeTitle}_results${detailed ? '_detailed' : ''}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // stream workbook to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /:id/results/download error:', err);
    return res.status(500).json({ message: err.message || 'Failed to generate Excel' });
  }
});

/**
 * GET /api/quiz/all
 * List teacher quizzes
 */
router.get('/all', protect, async (req, res) => {
  try {
    const quizzes = await Quiz.find({ userId: req.user._id })
      .populate('folderId')
      .sort('-createdAt')
      .lean();
    return res.json(quizzes);
  } catch (err) {
    console.error('GET /all error:', err);
    return res.status(500).json({ message: err.message || 'Failed to fetch quizzes' });
  }
});

/**
 * POST /api/quiz/save
 * Create a new quiz
 */
router.post('/save', protect, async (req, res) => {
  try {
    const payload = { ...req.body, userId: req.user._id };
    const quiz = await Quiz.create(payload);
    return res.status(201).json({ success: true, quizId: quiz._id, quiz });
  } catch (err) {
    console.error('POST /save error:', err);
    return res.status(400).json({ message: err.message || 'Failed to save quiz' });
  }
});

/**
 * POST /api/quiz/share
 * Body: { quizId: string, studentEmails: string[] }
 */
router.post('/share', protect, async (req, res) => {
  try {
    const { quizId, studentEmails } = req.body;

    if (!quizId) return res.status(400).json({ success: false, message: 'quizId is required' });
    if (!Array.isArray(studentEmails) || studentEmails.length === 0) {
      return res.status(400).json({ success: false, message: 'studentEmails must be a non-empty array' });
    }

    const quiz = await Quiz.findOne({ _id: quizId, userId: req.user._id });
    if (!quiz) return res.status(404).json({ success: false, message: 'Quiz not found' });

    // Base frontend URL (ensure no trailing slash)
    const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Optionally verify email transporter (warn only)
    const emailReady = await emailService.verifyConnection().catch(() => false);
    if (!emailReady) console.warn('Email service not verified; emails may fail.');

    const sent = [];
    const failed = [];
    const invalid = [];
    const alreadySent = [];

    // Process serially for clearer logging and to avoid SMTP rate-limit bursts.
    for (const raw of studentEmails) {
      const email = String(raw || '').trim().toLowerCase();

      if (!email || !emailRegex.test(email)) {
        invalid.push({ email: raw, reason: 'Invalid email format' });
        continue;
      }

      // Check if an attempt already exists for this quiz + email
      let attempt = await QuizAttempt.findOne({ quizId: quiz._id, studentEmail: email });

      // If attempt exists and we've already sent the email, skip sending again
      if (attempt && attempt.emailSent) {
        alreadySent.push({ email, link: `${frontendBase}/quiz/attempt/${attempt.uniqueToken}`, token: attempt.uniqueToken });
        continue;
      }

      // Create attempt if missing
      if (!attempt) {
        // Create a secure random token (32 bytes => 64 hex chars)
        const token = crypto.randomBytes(32).toString('hex');

        attempt = new QuizAttempt({
          quizId: quiz._id,
          teacherId: req.user._id,
          studentEmail: email,
          uniqueToken: token,
          emailSent: false,
          maxMarks: Array.isArray(quiz.questions) ? quiz.questions.reduce((s, q) => s + (q.marks ?? 1), 0) : 0
        });

        try {
          await attempt.save();
        } catch (saveErr) {
          console.error(`Failed to create QuizAttempt for ${email}:`, saveErr);
          failed.push({ email, reason: `Failed to create attempt: ${saveErr.message}` });
          continue;
        }
      }

      const uniqueLink = `${frontendBase}/quiz/attempt/${attempt.uniqueToken}`;

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
          sent.push({ email, link: uniqueLink, token: attempt.uniqueToken });
        } else {
          const reason = (sendRes && (sendRes.error || sendRes.message)) ? (sendRes.error || sendRes.message) : 'Unknown send error';
          failed.push({ email, reason });
          console.error(`Failed to send to ${email}:`, reason);
        }
      } catch (err) {
        const reason = err && err.message ? err.message : String(err);
        failed.push({ email, reason });
        console.error(`Exception sending to ${email}:`, reason);
      }
    } // end for

    const response = {
      success: true,
      message: `Quiz links sent to ${sent.length} student(s)`,
      links: sent,
      alreadySent,
      failed,
      invalid
    };

    if (sent.length === 0) {
      return res.status(400).json(response);
    }

    return res.json(response);
  } catch (err) {
    console.error('POST /share error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Internal server error' });
  }
});

/**
 * GET /api/quiz/:id
 * Fetch a single quiz (teacher only). Must be after more specific routes.
 */
router.get('/:id', protect, async (req, res) => {
  try {
    const quiz = await Quiz.findOne({ _id: req.params.id, userId: req.user._id }).populate('folderId');
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });
    return res.json(quiz);
  } catch (err) {
    console.error('GET /:id error:', err);
    return res.status(400).json({ message: err.message || 'Failed to fetch quiz' });
  }
});

module.exports = router;
