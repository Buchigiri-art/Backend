// backend/routes/quiz.js
const express = require('express');
const crypto = require('crypto');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const Student = require('../models/Student');
const emailService = require('../services/emailService');
const excelService = require('../services/excelService');
const { protect } = require('../middleware/auth');

const router = express.Router();

/**
 * ROUTE ORDER MATTERS
 */

/**
 * GET /api/quiz/results/all
 * Get all quizzes for the current teacher with aggregated attempt statistics
 */
router.get('/results/all', protect, async (req, res) => {
  try {
    const teacherId = req.user._id;

    const quizzes = await Quiz.find({ userId: teacherId })
      .sort('-createdAt')
      .lean();

    if (quizzes.length === 0) {
      return res.json([]);
    }

    const quizIds = quizzes.map((q) => q._id);

    const stats = await QuizAttempt.aggregate([
      {
        $match: {
          quizId: { $in: quizIds },
          teacherId,
        },
      },
      {
        $group: {
          _id: '$quizId',
          attemptCount: { $sum: 1 },
          submittedCount: {
            $sum: {
              $cond: [{ $in: ['$status', ['submitted', 'graded']] }, 1, 0],
            },
          },
          totalPercentage: {
            $sum: { $ifNull: ['$percentage', 0] },
          },
        },
      },
    ]);

    const statsMap = new Map();
    stats.forEach((s) => {
      const avg = s.submittedCount > 0 ? s.totalPercentage / s.submittedCount : 0;
      statsMap.set(String(s._id), {
        attemptCount: s.attemptCount,
        submittedCount: s.submittedCount,
        averageScore: avg,
      });
    });

    const quizzesWithStats = quizzes.map((quiz) => {
      const s = statsMap.get(String(quiz._id)) || {
        attemptCount: 0,
        submittedCount: 0,
        averageScore: 0,
      };
      return {
        ...quiz,
        attemptCount: s.attemptCount,
        submittedCount: s.submittedCount,
        averageScore: s.averageScore,
      };
    });

    res.json(quizzesWithStats);
  } catch (error) {
    console.error('GET /quiz/results/all error:', error);
    res.status(500).json({ message: error.message || 'Failed to fetch results' });
  }
});

/**
 * GET /api/quiz/:id/results/:attemptId
 * Get a single student's attempt with all answers (teacher only)
 */
router.get('/:id/results/:attemptId', protect, async (req, res) => {
  try {
    const { id: quizId, attemptId } = req.params;

    const attempt = await QuizAttempt.findOne({
      _id: attemptId,
      quizId,
      teacherId: req.user._id,
    }).lean();

    if (!attempt) {
      return res.status(404).json({ success: false, message: 'Attempt not found' });
    }

    const questions = (attempt.answers || []).map((a) => {
      const options = Array.isArray(a.options) ? a.options : [];
      const studentAnswer = a.studentAnswer || '';
      const correctAnswer = a.correctAnswer || '';

      const selectedOptionIndex = options.length ? options.indexOf(studentAnswer) : -1;
      const correctOptionIndex = options.length ? options.indexOf(correctAnswer) : -1;

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
    console.error(
      `GET /quiz/${req.params.id}/results/${req.params.attemptId} error:`,
      error,
    );
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch attempt detail',
    });
  }
});

/**
 * GET /api/quiz/:id/results
 * Get quiz and attempts (teacher only)
 */
router.get('/:id/results', protect, async (req, res) => {
  try {
    const quizId = req.params.id;
    const teacherId = req.user._id;

    const quiz = await Quiz.findOne({ _id: quizId, userId: teacherId })
      .select('title description questions')
      .lean();

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const attempts = await QuizAttempt.find({
      quizId,
      teacherId,
    })
      .sort('-submittedAt')
      .lean();

    res.json({
      success: true,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        numQuestions: Array.isArray(quiz.questions) ? quiz.questions.length : 0,
      },
      attempts,
    });
  } catch (error) {
    console.error(`GET /quiz/${req.params.id}/results error:`, error);
    res.status(500).json({ message: error.message || 'Failed to fetch attempts' });
  }
});

/**
 * GET /api/quiz/:id/results/download
 * Summary or detailed Excel export using ExcelService (XLSX)
 */
router.get('/:id/results/download', protect, async (req, res) => {
  try {
    const quizId = req.params.id;
    const teacherId = req.user._id;
    const detailed = String(req.query.detailed || 'false').toLowerCase() === 'true';

    const quiz = await Quiz.findOne({ _id: quizId, userId: teacherId }).lean();
    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }

    const attempts = await QuizAttempt.find({
      quizId,
      teacherId,
    })
      .sort('-submittedAt')
      .lean();

    let buffer;

    if (detailed) {
      buffer = excelService.generateDetailedQuizResultsExcel(
        quiz.title || 'Quiz',
        quiz,
        attempts,
      );
    } else {
      buffer = excelService.generateQuizResultsExcel(quiz.title || 'Quiz', attempts);
    }

    const safeTitle = (quiz.title || 'quiz')
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();
    const filename = `${safeTitle}_results${detailed ? '_detailed' : ''}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.send(buffer);
  } catch (err) {
    console.error('GET /quiz/:id/results/download error:', err);
    if (!res.headersSent) {
      return res.status(500).json({ message: err.message || 'Failed to generate Excel' });
    }
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
    console.error('GET /quiz/all error:', err);
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
    console.error('POST /quiz/save error:', err);
    return res.status(400).json({ message: err.message || 'Failed to save quiz' });
  }
});

/**
 * POST /api/quiz/share
 * Optimized share (same as you had, sending emails in background)
 */
router.post('/share', protect, async (req, res) => {
  try {
    const { quizId, studentEmails, forceResend } = req.body || {};

    if (!quizId) {
      return res
        .status(400)
        .json({ success: false, message: 'quizId is required' });
    }
    if (!Array.isArray(studentEmails) || studentEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'studentEmails must be a non-empty array',
      });
    }

    const quiz = await Quiz.findOne({ _id: quizId, userId: req.user._id });
    if (!quiz) {
      return res
        .status(404)
        .json({ success: false, message: 'Quiz not found' });
    }

    const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(
      /\/$/,
      '',
    );
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    const normalisedEmails = Array.from(
      new Set(
        studentEmails
          .map((raw) => String(raw || '').trim().toLowerCase())
          .filter(Boolean),
      ),
    );

    if (normalisedEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid emails to share',
      });
    }

    const students = await Student.find({
      userId: req.user._id,
      email: { $in: normalisedEmails },
    }).lean();

    const studentMap = new Map();
    students.forEach((s) => {
      studentMap.set(String(s.email).toLowerCase(), s);
    });

    const attempts = await QuizAttempt.find({
      quizId,
      studentEmail: { $in: normalisedEmails },
    });

    const attemptMap = new Map();
    attempts.forEach((a) => {
      attemptMap.set(String(a.studentEmail || '').toLowerCase(), a);
    });

    const sentLinks = [];
    const alreadySent = [];
    const invalid = [];
    const backgroundJobs = [];

    for (const rawEmail of studentEmails) {
      const email = String(rawEmail || '').trim().toLowerCase();

      if (!email || !emailRegex.test(email)) {
        invalid.push({ email: rawEmail, reason: 'Invalid email format' });
        continue;
      }

      const student = studentMap.get(email) || null;
      let attempt = attemptMap.get(email) || null;

      if (attempt) {
        if (attempt.emailSent && !forceResend) {
          const link = `${frontendBase}/quiz/attempt/${attempt.uniqueToken}`;
          alreadySent.push({
            email,
            link,
            token: attempt.uniqueToken,
          });
          sentLinks.push({ email, link, token: attempt.uniqueToken });
          continue;
        }

        let needsUpdate = false;

        if (student) {
          if (!attempt.studentName && student.name) {
            attempt.studentName = student.name;
            needsUpdate = true;
          }
          if (!attempt.studentUSN && student.usn) {
            attempt.studentUSN = student.usn;
            needsUpdate = true;
          }
          if (!attempt.studentBranch && student.branch) {
            attempt.studentBranch = student.branch;
            needsUpdate = true;
          }
          if (!attempt.studentYear && student.year) {
            attempt.studentYear = student.year;
            needsUpdate = true;
          }
          if (!attempt.studentSemester && student.semester) {
            attempt.studentSemester = student.semester;
            needsUpdate = true;
          }
        }

        if (forceResend) {
          attempt.uniqueToken = crypto.randomBytes(32).toString('hex');
          attempt.emailSent = false;
          attempt.sentAt = null;
          needsUpdate = true;
        }

        if (needsUpdate) {
          await attempt.save();
        }
      }

      if (!attempt) {
        const token = crypto.randomBytes(32).toString('hex');
        const maxMarks = Array.isArray(quiz.questions)
          ? quiz.questions.reduce((s, q) => s + (q.marks ?? 1), 0)
          : 0;

        attempt = new QuizAttempt({
          quizId: quiz._id,
          teacherId: req.user._id,
          studentEmail: email,

          studentName: student?.name || '',
          studentUSN: student?.usn || '',
          studentBranch: student?.branch || '',
          studentYear: student?.year || '',
          studentSemester: student?.semester || '',

          uniqueToken: token,
          emailSent: false,
          maxMarks,
        });

        try {
          await attempt.save();
          attemptMap.set(email, attempt);
        } catch (saveErr) {
          console.error(`Failed to create QuizAttempt for ${email}:`, saveErr);
          invalid.push({
            email,
            reason: `Failed to create attempt: ${saveErr.message}`,
          });
          continue;
        }
      }

      const uniqueLink = `${frontendBase}/quiz/attempt/${attempt.uniqueToken}`;

      sentLinks.push({
        email,
        link: uniqueLink,
        token: attempt.uniqueToken,
      });

      backgroundJobs.push({
        attemptId: attempt._id,
        email,
        uniqueLink,
      });
    }

    (async () => {
      for (const job of backgroundJobs) {
        try {
          const attempt = await QuizAttempt.findById(job.attemptId);
          if (!attempt) continue;

          const sendRes = await emailService.sendQuizInvitation(
            job.email,
            quiz.title || 'Untitled Quiz',
            job.uniqueLink,
            req.user.name || 'Teacher',
          );

          if (sendRes && sendRes.success) {
            attempt.emailSent = true;
            attempt.sentAt = new Date();
            await attempt.save();
          } else {
            console.error(`Failed to send quiz email to ${job.email}:`, sendRes);
          }
        } catch (err) {
          console.error(
            `Error sending quiz email in background for ${job.email}:`,
            err.message || err,
          );
        }
      }
    })().catch((err) => {
      console.error('Background email sending error:', err);
    });

    const response = {
      success: true,
      message: `Quiz links generated for ${sentLinks.length} student(s). Emails are being sent in the background.`,
      links: sentLinks,
      alreadySent,
      invalid,
      failed: [],
    };

    return res.status(200).json(response);
  } catch (err) {
    console.error('POST /quiz/share error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Internal server error',
    });
  }
});

/**
 * DELETE /api/quiz/:id
 * Delete a quiz and all its attempts (teacher only)
 */
router.delete('/:id', protect, async (req, res) => {
  try {
    const quizId = req.params.id;

    const quiz = await Quiz.findOne({
      _id: quizId,
      userId: req.user._id,
    });

    if (!quiz) {
      return res
        .status(404)
        .json({ success: false, message: 'Quiz not found' });
    }

    await QuizAttempt.deleteMany({
      quizId: quiz._id,
      teacherId: req.user._id,
    });

    await quiz.deleteOne();

    return res.json({ success: true, message: 'Quiz and attempts deleted' });
  } catch (err) {
    console.error('DELETE /quiz/:id error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to delete quiz',
    });
  }
});

/**
 * GET /api/quiz/:id
 * Fetch a single quiz (teacher only). Must be after more specific routes.
 */
router.get('/:id', protect, async (req, res) => {
  try {
    const quiz = await Quiz.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).populate('folderId');

    if (!quiz) {
      return res.status(404).json({ message: 'Quiz not found' });
    }
    return res.json(quiz);
  } catch (err) {
    console.error('GET /quiz/:id error:', err);
    return res
      .status(400)
      .json({ message: err.message || 'Failed to fetch quiz' });
  }
});

module.exports = router;
