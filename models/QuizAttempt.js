// models/QuizAttempt.js
const mongoose = require('mongoose');

const attemptAnswerSchema = new mongoose.Schema({
  questionId: { type: String },
  question: { type: String },
  type: { type: String, enum: ['mcq', 'short-answer'], default: 'short-answer' },
  options: { type: [String], default: [] },
  studentAnswer: { type: String, default: '' },
  correctAnswer: { type: String, default: '' },
  isCorrect: { type: Boolean, default: false },
  marks: { type: Number, default: 0 },
  explanation: { type: String, default: '' }
}, { _id: false });

const cheatLogSchema = new mongoose.Schema({
  at: { type: Date, default: Date.now },
  reason: { type: String, default: '' },
  fromIp: { type: String } // optional
}, { _id: false });

const quizAttemptSchema = new mongoose.Schema({
  quizId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quiz',
    required: true
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  studentName: { type: String, default: '' },
  studentUSN: { type: String, default: '' },
  studentEmail: { type: String, required: true, trim: true, lowercase: true },
  studentBranch: { type: String, default: '' },
  studentYear: { type: String, default: '' },
  studentSemester: { type: String, default: '' },

  answers: { type: [attemptAnswerSchema], default: [] },

  totalMarks: { type: Number, default: 0 },
  maxMarks: { type: Number, default: 0 },
  percentage: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ['pending', 'started', 'submitted', 'graded'],
    default: 'pending'
  },

  startedAt: Date,
  submittedAt: Date,
  gradedAt: Date,

  uniqueToken: { type: String, required: true, unique: true },

  // Email metadata
  emailSent: { type: Boolean, default: false },
  sentAt: Date,

  // Anti-cheat / monitoring fields
  warningCount: { type: Number, default: 0 },
  lastWarningAt: Date,
  isCheated: { type: Boolean, default: false },
  cheatLogs: { type: [cheatLogSchema], default: [] }
}, { timestamps: true });

// Indexes for performance
quizAttemptSchema.index({ teacherId: 1, quizId: 1 });
quizAttemptSchema.index({ uniqueToken: 1 });
quizAttemptSchema.index({ studentEmail: 1, quizId: 1 });

module.exports = mongoose.model('QuizAttempt', quizAttemptSchema);
