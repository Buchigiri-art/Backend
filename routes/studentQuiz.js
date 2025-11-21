// routes/studentQuiz.js
const express = require('express');
const Quiz = require('../models/Quiz');
const QuizAttempt = require('../models/QuizAttempt');

const router = express.Router();

/**
 * GET /api/student-quiz/attempt/:token
 * If an attempt exists for the token, return attempt+quiz data.
 * Otherwise invalid/expired.
 */
router.get('/attempt/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) return res.status(400).json({ message: 'Token required' });

    const attempt = await QuizAttempt.findOne({ uniqueToken: token }).populate('quizId').lean();
    if (!attempt) {
      return res.status(404).json({ message: 'Invalid or expired link' });
    }

    if (['submitted','graded'].includes(attempt.status)) {
      return res.json({ alreadySubmitted: true, message: 'This quiz has already been submitted' });
    }

    const quiz = attempt.quizId;
    if (!quiz) return res.status(404).json({ message: 'Quiz not found' });

    return res.json({
      quiz: {
        id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration || 30,
        questions: (quiz.questions || []).map(q => ({
          id: q.id || q._id,
          type: q.type,
          question: q.question,
          options: q.options || []
        }))
      },
      attemptId: attempt._id,
      studentInfo: {
        name: attempt.studentName || '',
        usn: attempt.studentUSN || '',
        email: attempt.studentEmail || '',
        branch: attempt.studentBranch || '',
        year: attempt.studentYear || '',
        semester: attempt.studentSemester || ''
      },
      hasStarted: attempt.status === 'started' || attempt.status === 'pending' ? (attempt.status === 'started') : false,
      warningCount: attempt.warningCount || 0,
      isCheated: attempt.isCheated || false
    });
  } catch (err) {
    console.error('GET /attempt/:token error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

/**
 * POST /api/student-quiz/attempt/start
 * Body: { token, studentName, studentUSN, studentBranch, studentYear, studentSemester }
 */
router.post('/attempt/start', async (req, res) => {
  try {
    const { token, studentName, studentUSN, studentBranch, studentYear, studentSemester } = req.body;
    if (!token || !studentName || !studentUSN || !studentBranch || !studentYear || !studentSemester) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const attempt = await QuizAttempt.findOne({ uniqueToken: token });
    if (!attempt) return res.status(404).json({ message: 'Invalid token' });

    if (['submitted','graded'].includes(attempt.status)) {
      return res.status(400).json({ message: 'Quiz already submitted' });
    }

    // Update attempt and mark started
    attempt.studentName = studentName.trim();
    attempt.studentUSN = studentUSN.trim().toUpperCase();
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
        id: quiz._1,
        title: quiz.title,
        description: quiz.description,
        duration: quiz.duration || 30,
        questions: (quiz.questions || []).map(q => ({
          id: q.id || q._id,
          type: q.type,
          question: q.question,
          options: q.options || []
        }))
      }
    });
  } catch (err) {
    console.error('POST /attempt/start error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

/**
 * POST /api/student-quiz/attempt/flag
 * Body: { token, reason }
 * Called by frontend when a visibility/blur/fullscreen event occurs.
 * Increments warningCount, stores a log. On 4th warning, auto-submit attempt (mark as submitted/graded with zero).
 */
router.post('/attempt/flag', async (req, res) => {
  try {
    const { token, reason } = req.body;
    if (!token) return res.status(400).json({ message: 'Token required' });

    const attempt = await QuizAttempt.findOne({ uniqueToken: token }).populate('quizId');
    if (!attempt) return res.status(404).json({ message: 'Invalid token' });

    if (['submitted','graded'].includes(attempt.status)) {
      return res.status(400).json({ message: 'Attempt already submitted' });
    }

    // increment warning
    attempt.warningCount = (attempt.warningCount || 0) + 1;
    attempt.lastWarningAt = new Date();
    attempt.cheatLogs = attempt.cheatLogs || [];
    attempt.cheatLogs.push({ at: new Date(), reason: reason || 'visibility/blur/fullscreen' });

    // If reached threshold => auto-submit as cheating
    const threshold = 4;
    let autoSubmitted = false;

    if (attempt.warningCount >= threshold) {
      // mark as cheated and submitted with zero marks
      attempt.isCheated = true;
      attempt.status = 'submitted';
      attempt.submittedAt = new Date();
      attempt.gradedAt = new Date();

      // set marks to zero and maxMarks to quiz length (or computed)
      const quiz = attempt.quizId;
      const maxMarks = Array.isArray(quiz?.questions) ? quiz.questions.reduce((s, q) => s + (q.marks ?? 1), 0) : 0;
      attempt.totalMarks = 0;
      attempt.maxMarks = maxMarks;
      attempt.percentage = maxMarks > 0 ? 0 : 0;

      autoSubmitted = true;
    }

    await attempt.save();

    return res.json({
      success: true,
      warningCount: attempt.warningCount,
      autoSubmitted,
      message: autoSubmitted ? 'Auto-submitted due to repeated warnings' : 'Warning logged'
    });
  } catch (err) {
    console.error('POST /attempt/flag error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

/**
 * POST /api/student-quiz/attempt/submit
 * Body: { attemptId, answers: [] }
 * Grading logic remains same as before (keeps current behavior)
 */
router.post('/attempt/submit', async (req, res) => {
  try {
    const { attemptId, answers } = req.body;
    if (!attemptId || !Array.isArray(answers)) return res.status(400).json({ message: 'attemptId and answers are required' });

    const attempt = await QuizAttempt.findById(attemptId).populate('quizId');
    if (!attempt) return res.status(404).json({ message: 'Attempt not found' });
    if (['submitted','graded'].includes(attempt.status)) return res.status(400).json({ message: 'Attempt already submitted' });

    const quiz = attempt.quizId;
    let totalMarks = 0;
    let maxMarks = 0;
    const gradedAnswers = [];

    for (let i = 0; i < (quiz.questions || []).length; i++) {
      const q = quiz.questions[i];
      const studentAns = answers[i] ?? '';
      const marks = q.marks ?? 1;
      maxMarks += marks;
      let isCorrect = false;

      if (q.answer !== undefined && q.answer !== null) {
        if (String(q.answer).trim().toLowerCase() === String(studentAns).trim().toLowerCase()) {
          isCorrect = true;
          totalMarks += marks;
        }
      }

      gradedAnswers.push({
        questionId: q.id || q._id,
        question: q.question,
        type: q.type,
        options: q.options || [],
        studentAnswer: studentAns,
        correctAnswer: q.answer,
        isCorrect,
        marks
      });
    }

    const percentage = maxMarks > 0 ? Number(((totalMarks / maxMarks) * 100).toFixed(2)) : 0;

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
      message: 'Quiz submitted successfully',
      results: { totalMarks, maxMarks, percentage }
    });
  } catch (err) {
    console.error('POST /attempt/submit error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
});

module.exports = router;
