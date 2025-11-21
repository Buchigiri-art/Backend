const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  id: String,
  type: {
    type: String,
    enum: ['mcq', 'short-answer', 'mixed'],
    required: true
  },
  question: {
    type: String,
    required: true
  },
  options: [String],
  answer: String,
  explanation: String
});

const bookmarkSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder'
  },
  // Support for full quiz bookmarks
  type: {
    type: String,
    enum: ['question', 'quiz'],
    default: 'question'
  },
  // For single question bookmarks (legacy)
  question: {
    id: String,
    type: {
      type: String,
      enum: ['mcq', 'short-answer', 'mixed']
    },
    question: String,
    options: [String],
    answer: String,
    explanation: String
  },
  // For full quiz bookmarks
  quiz: {
    title: String,
    description: String,
    questions: [questionSchema],
    numQuestions: Number,
    questionType: String,
    duration: Number,
    difficulty: {
      type: String,
      enum: ['easy', 'medium', 'hard', 'mixed']
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Bookmark', bookmarkSchema);
