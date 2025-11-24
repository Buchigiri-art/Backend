// routes/studentQuiz.js
const express = require('express');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');
const Student = require('../models/Student');

const router = express.Router();

/**
 * GET /api/student-quiz/attempt/:token
 * Loads quiz + attempt + student details from Student collection
 */
router.get('/attempt/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ message: 'Token required' });

    const attempt = await QuizAttempt.findOne({ uniqueToken: token })
      .populate('quizId')
      .lean();

    if (!attempt) {
      return res.status(404).json({ message: 'Invalid or expired link' });
    }

    if (['submitted', 'graded'].includes(attempt.status)) {
      return res.json({
        alreadySubmitted: true,
        message: 'This quiz has already been submitted',
      });
    }

    const quiz = attempt.quizId;
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    // -----------------------------------------
    // ⭐ Fetch Student details from DB
    // -----------------------------------------
    let studentInfo = null;

    if (attempt.studentEmail) {
      const student = await Student.findOne({
        email: attempt.studentEmail.toLowerCase(),
        userId: attempt.teacherId,
      }).lean();

      if (student) {
        studentInfo = {
          name: student.name,
          usn: student.usn,
          email: student.email,
          branch: student.branch,
          year: student.year,
          semester: student.semester,
        };
      }
    }

    // fallback if student not found in DB
    if (!studentInfo) {
      studentInfo = {
        name: attempt.studentName || '',
        usn: attempt.studentUSN || '',
        email: attempt.studentEmail || '',
        branch: attempt.studentBranch || '',
        year: attempt.studentYear || '',
        semester: attempt.studentSemester || '',
      };
    }

    return res.json({
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration || 30,
        questions: (quiz.questions || []).map((q) => ({
          id: q.id || q._id,
          type: q.type,
          question: q.question,
          options: q.options || [],
        })),
      },

      attemptId: attempt._id,
      studentInfo,
      email: studentInfo.email,

      hasStarted: attempt.status === 'started',
      alreadySubmitted: false,
      warningCount: attempt.warningCount || 0,
      isCheated: attempt.isCheated || false,
    });
  } catch (err) {
    console.error('GET /attempt/:token error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

/**
 * POST /api/student-quiz/attempt/start
 */
router.post('/attempt/start', async (req, res) => {
  try {
    const {
      token,
      studentName,
      studentUSN,
      studentBranch,
      studentYear,
      studentSemester,
    } = req.body;

    if (
      !token ||
      !studentName ||
      !studentUSN ||
      !studentBranch ||
      !studentYear ||
      !studentSemester
    ) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const attempt = await QuizAttempt.findOne({ uniqueToken: token });
    if (!attempt) return res.status(404).json({ message: 'Invalid token' });

    if (['submitted', 'graded'].includes(attempt.status)) {
      return res.status(400).json({ message: 'Quiz already submitted' });
    }

    // Update attempt
    attempt.studentName = studentName;
    attempt.studentUSN = studentUSN;
    attempt.studentBranch = studentBranch;
    attempt.studentYear = studentYear;
    attempt.studentSemester = studentSemester;

    attempt.status = 'started';
    attempt.startedAt = new Date();
    await attempt.save();

    const quiz = await Quiz.findById(attempt.quizId).lean();
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    return res.json({
      attemptId: attempt._id,
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration || 30,
        questions: (quiz.questions || []).map((q) => ({
          id: q.id || q._id,
          type: q.type,
          question: q.question,
          options: q.options || [],
        })),
      },
    });
  } catch (err) {
    console.error('POST /attempt/start error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

/**
 * POST /api/student-quiz/attempt/flag
 */
router.post('/attempt/flag', async (req, res) => {
  try {
    const { token, reason } = req.body;
    if (!token) return res.status(400).json({ message: 'Token required' });

    const attempt = await QuizAttempt.findOne({ uniqueToken: token }).populate(
      'quizId'
    );

    if (!attempt) return res.status(404).json({ message: 'Invalid token' });
    if (['submitted', 'graded'].includes(attempt.status))
      return res.status(400).json({ message: 'Attempt already submitted' });

    attempt.warningCount = (attempt.warningCount || 0) + 1;
    attempt.lastWarningAt = new Date();
    attempt.cheatLogs = attempt.cheatLogs || [];

    attempt.cheatLogs.push({
      at: new Date(),
      reason: reason || 'violation',
    });

    const threshold = 4;
    let autoSubmitted = false;

    if (attempt.warningCount >= threshold) {
      attempt.isCheated = true;
      attempt.status = 'submitted';
      attempt.submittedAt = new Date();
      attempt.gradedAt = new Date();

      const quiz = attempt.quizId;
      const maxMarks = quiz.questions.reduce(
        (s, q) => s + (q.marks ?? 1),
        0
      );

      attempt.totalMarks = 0;
      attempt.maxMarks = maxMarks;
      attempt.percentage = 0;

      autoSubmitted = true;
    }

    await attempt.save();

    return res.json({
      success: true,
      warningCount: attempt.warningCount,
      autoSubmitted,
    });
  } catch (err) {
    console.error('POST /attempt/flag error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

/**
 * POST /api/student-quiz/attempt/submit
 */
router.post('/attempt/submit', async (req, res) => {
  try {
    const { attemptId, answers } = req.body;
    if (!attemptId || !Array.isArray(answers))
      return res
        .status(400)
        .json({ message: 'attemptId and answers are required' });

    const attempt = await QuizAttempt.findById(attemptId).populate('quizId');
    if (!attempt) return res.status(404).json({ message: 'Attempt not found' });

    if (['submitted', 'graded'].includes(attempt.status)) {
      return res.status(400).json({ message: 'Attempt already submitted' });
    }

    const quiz = attempt.quizId;

    let totalMarks = 0;
    let maxMarks = 0;
    const gradedAnswers = [];

    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const studentAns = answers[i] ?? '';
      const marks = q.marks ?? 1;

      maxMarks += marks;

      let isCorrect = false;
      if (q.answer) {
        isCorrect =
          q.answer.toString().trim().toLowerCase() ===
          studentAns.toString().trim().toLowerCase();
      }

      if (isCorrect) totalMarks += marks;

      gradedAnswers.push({
        questionId: q._id,
        question: q.question,
        type: q.type,
        options: q.options || [],
        studentAnswer: studentAns,
        correctAnswer: q.answer,
        isCorrect,
        marks,
      });
    }

    const percentage =
      maxMarks > 0 ? Number(((totalMarks / maxMarks) * 100).toFixed(2)) : 0;

    attempt.answers = gradedAnswers;
    attempt.totalMarks = totalMarks;
    attempt.maxMarks = maxMarks;
    attempt.percentage = percentage;
    attempt.status = 'graded';
    attempt.submittedAt = new Date();
    attempt.gradedAt = new Date();

    await attempt.save();

    return res.json({
      success: true,
      results: { totalMarks, maxMarks, percentage },
    });
  } catch (err) {
    console.error('POST /attempt/submit error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
