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
  answer: {
    type: String,
    required: true
  },
  explanation: String,
  isBookmarked: {
    type: Boolean,
    default: false
  }
});

const quizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: String,
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Folder'
  },
  questions: [questionSchema],
  numQuestions: Number,
  questionType: String,
  duration: Number,
  difficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard', 'mixed']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Quiz', quizSchema);
