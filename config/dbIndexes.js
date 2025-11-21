const User = require('../models/User');
const Quiz = require('../models/Quiz');
const Student = require('../models/Student');
const Bookmark = require('../models/Bookmark');
const Folder = require('../models/Folder');

// Create database indexes for better performance
exports.createIndexes = async () => {
  try {
    // User indexes
    await User.collection.createIndex({ email: 1 }, { unique: true });
    
    // Quiz indexes - optimize queries by userId
    await Quiz.collection.createIndex({ userId: 1, createdAt: -1 });
    await Quiz.collection.createIndex({ userId: 1, folderId: 1 });
    
    // Student indexes - optimize queries by userId
    await Student.collection.createIndex({ userId: 1, createdAt: -1 });
    await Student.collection.createIndex({ userId: 1, email: 1 });
    await Student.collection.createIndex({ userId: 1, usn: 1 });
    
    // Bookmark indexes - optimize queries by userId
    await Bookmark.collection.createIndex({ userId: 1, createdAt: -1 });
    await Bookmark.collection.createIndex({ userId: 1, folderId: 1 });
    
    // Folder indexes - optimize queries by userId
    await Folder.collection.createIndex({ userId: 1, createdAt: -1 });
    
    console.log('Database indexes created successfully');
  } catch (error) {
    console.error('Error creating indexes:', error);
  }
};
