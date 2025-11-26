// backend/routes/quiz.js
const express = require('express');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const Student = require('../models/Student');
const emailService = require('../services/emailService');
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

    // 1) Get quizzes for this teacher
    const quizzes = await Quiz.find({ userId: teacherId })
      .sort('-createdAt')
      .lean();

    if (quizzes.length === 0) {
      return res.json([]);
    }

    const quizIds = quizzes.map((q) => q._id);

    // 2) Aggregate attempts once for all quizzes (no N+1 queries)
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
              $cond: [
                { $in: ['$status', ['submitted', 'graded']] },
                1,
                0,
              ],
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
      const avg =
        s.submittedCount > 0
          ? s.totalPercentage / s.submittedCount
          : 0;
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
    res
      .status(500)
      .json({ message: error.message || 'Failed to fetch results' });
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
      return res
        .status(404)
        .json({ success: false, message: 'Attempt not found' });
    }

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
    console.error(
      `GET /quiz/${req.params.id}/results/${req.params.attemptId} error:`,
      error
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
        numQuestions: Array.isArray(quiz.questions)
          ? quiz.questions.length
          : 0,
      },
      attempts,
    });
  } catch (error) {
    console.error(`GET /quiz/${req.params.id}/results error:`, error);
    res
      .status(500)
      .json({ message: error.message || 'Failed to fetch attempts' });
  }
});

/**
 * GET /api/quiz/:id/results/download
 */
router.get('/:id/results/download', protect, async (req, res) => {
  try {
    const quizId = req.params.id;
    const teacherId = req.user._id;
    const detailed =
      String(req.query.detailed || 'false').toLowerCase() === 'true';

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

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Results');

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
      { header: 'Submitted At', key: 'submittedAt', width: 22 },
    ];

    if (
      detailed &&
      Array.isArray(quiz.questions) &&
      quiz.questions.length > 0
    ) {
      quiz.questions.forEach((q, idx) => {
        header.push({
          header: `Q${idx + 1}`,
          key: `q_${idx + 1}`,
          width: 18,
        });
      });
    }

    sheet.columns = header;

    for (const a of attempts) {
      const row = {
        studentName: a.studentName || '',
        studentUSN: a.studentUSN || '',
        studentEmail: a.studentEmail || '',
        studentBranch: a.studentBranch || '',
        studentYear: a.studentYear || '',
        studentSemester: a.studentSemester || '',
        totalMarks:
          a.totalMarks !== undefined && a.totalMarks !== null
            ? a.totalMarks
            : '',
        maxMarks:
          a.maxMarks !== undefined && a.maxMarks !== null
            ? a.maxMarks
            : '',
        percentage:
          a.percentage !== undefined && a.percentage !== null
            ? a.percentage
            : '',
        status: a.status || '',
        submittedAt: a.submittedAt
          ? new Date(a.submittedAt).toLocaleString()
          : '',
      };

      if (detailed && Array.isArray(a.answers)) {
        for (let i = 0; i < quiz.questions.length; i++) {
          const ans =
            a.answers && a.answers[i]
              ? a.answers[i].studentAnswer
              : '';
          row[`q_${i + 1}`] = ans;
        }
      }

      sheet.addRow(row);
    }

    const safeTitle = (quiz.title || 'quiz')
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase();
    const filename = `${safeTitle}_results${
      detailed ? '_detailed' : ''
    }.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('GET /quiz/:id/results/download error:', err);
    return res
      .status(500)
      .json({ message: err.message || 'Failed to generate Excel' });
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
    return res
      .status(500)
      .json({ message: err.message || 'Failed to fetch quizzes' });
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
    return res
      .status(400)
      .json({ message: err.message || 'Failed to save quiz' });
  }
});

/**
 * POST /api/quiz/share
 * Body: { quizId: string, studentEmails: string[], forceResend?: boolean }
 *
 * - If forceResend = true → always generate NEW token + send NEW email
 * - If forceResend = false/undefined → keep old "alreadySent" behavior
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

    const frontendBase = (process.env.FRONTEND_URL ||
      'http://localhost:5173'
    ).replace(/\/$/, '');
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Normalise and dedupe emails
    const normalisedEmails = Array.from(
      new Set(
        studentEmails
          .map((raw) => String(raw || '').trim().toLowerCase())
          .filter(Boolean)
      )
    );

    if (normalisedEmails.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid emails to share',
      });
    }

    // Pre-load students for all emails
    const students = await Student.find({
      userId: req.user._id,
      email: { $in: normalisedEmails },
    }).lean();

    const studentMap = new Map();
    students.forEach((s) => {
      studentMap.set(String(s.email).toLowerCase(), s);
    });

    // Pre-load existing attempts for all these emails
    const attempts = await QuizAttempt.find({
      quizId,
      studentEmail: { $in: normalisedEmails },
    });

    const attemptMap = new Map();
    attempts.forEach((a) => {
      attemptMap.set(String(a.studentEmail || '').toLowerCase(), a);
    });

    const emailReady = await emailService.verifyConnection().catch(() => false);
    if (!emailReady) {
      console.warn('Email service not verified; emails may fail.');
    }

    const sent = [];
    const failed = [];
    const invalid = [];
    const alreadySent = [];

    for (const rawEmail of studentEmails) {
      const email = String(rawEmail || '').trim().toLowerCase();

      if (!email || !emailRegex.test(email)) {
        invalid.push({ email: rawEmail, reason: 'Invalid email format' });
        continue;
      }

      const student = studentMap.get(email) || null;
      let attempt = attemptMap.get(email) || null;

      // 1) Existing attempt handling
      if (attempt) {
        // Old behavior: if already sent and NOT forcing resend → just report alreadySent
        if (attempt.emailSent && !forceResend) {
          alreadySent.push({
            email,
            link: `${frontendBase}/quiz/attempt/${attempt.uniqueToken}`,
            token: attempt.uniqueToken,
          });
          continue;
        }

        // Backfill from Student
        if (student) {
          let needsUpdate = false;

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

          // If forcing resend: generate NEW token
          if (forceResend) {
            attempt.uniqueToken = crypto.randomBytes(32).toString('hex');
            attempt.emailSent = false;
            attempt.sentAt = null;
            needsUpdate = true;
          }

          if (needsUpdate) {
            await attempt.save();
          }
        } else if (forceResend) {
          // No student record, but still force new token
          attempt.uniqueToken = crypto.randomBytes(32).toString('hex');
          attempt.emailSent = false;
          attempt.sentAt = null;
          await attempt.save();
        }
      }

      // 2) Create attempt if missing
      if (!attempt) {
        const token = crypto.randomBytes(32).toString('hex');
        const maxMarks = Array.isArray(quiz.questions)
          ? quiz.questions.reduce(
              (s, q) => s + (q.marks ?? 1),
              0
            )
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
          failed.push({
            email,
            reason: `Failed to create attempt: ${saveErr.message}`,
          });
          continue;
        }
      }

      // 3) Send email with current token
      const uniqueLink = `${frontendBase}/quiz/attempt/${attempt.uniqueToken}`;

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
          const reason =
            (sendRes && (sendRes.error || sendRes.message)) ||
            'Unknown send error';
          failed.push({ email, reason });
          console.error(`Failed to send to ${email}:`, reason);
        }
      } catch (err) {
        const reason = err && err.message ? err.message : String(err);
        failed.push({ email, reason });
        console.error(`Exception sending to ${email}:`, reason);
      }
    }

    const response = {
      success: true,
      message: `Quiz links sent to ${sent.length} student(s)`,
      links: sent,
      alreadySent,
      failed,
      invalid,
    };

    // Always 200 for valid request, even if sent.length === 0
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
