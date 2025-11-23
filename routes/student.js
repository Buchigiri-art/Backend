const express = require('express');
const Student = require('../models/Student');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Constants
const ERROR_MESSAGES = {
  STUDENT_NOT_FOUND: 'Student not found',
  INVALID_REQUEST: 'Invalid request body',
  STUDENTS_REQUIRED: 'Students array is required',
  SERVER_ERROR: 'Internal server error'
};

// Validation middleware
const validateStudentRequest = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.INVALID_REQUEST 
    });
  }
  next();
};

const validateBulkUpload = (req, res, next) => {
  const { students } = req.body;

  if (!Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.STUDENTS_REQUIRED 
    });
  }

  // Validate each student has required fields
  for (let i = 0; i < students.length; i++) {
    const student = students[i];
    if (!student.name || !student.name.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: `Student at index ${i} is missing required field: name` 
      });
    }
    if (!student.email || !student.email.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: `Student at index ${i} is missing required field: email` 
      });
    }
    if (!student.usn || !student.usn.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: `Student at index ${i} is missing required field: usn` 
      });
    }
  }

  next();
};

// Helper functions
const sanitizeStudent = (student) => ({
  id: student._id || student.id,
  name: student.name,
  usn: student.usn,
  email: student.email,
  branch: student.branch,
  year: student.year,
  semester: student.semester,
  userId: student.userId,
  createdAt: student.createdAt,
  updatedAt: student.updatedAt
});

const validateUSN = (usn) => {
  const usnRegex = /^[1-9][A-Za-z0-9]{9}$/;
  return usnRegex.test(usn);
};

const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

// Get all students with pagination and search
router.get('/all', protect, asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 50, 
    search,
    branch,
    year,
    semester,
    sortBy = '-createdAt' 
  } = req.query;

  // Build query
  const query = { userId: req.user._id };
  
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { usn: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  if (branch) query.branch = branch;
  if (year) query.year = year;
  if (semester) query.semester = semester;

  const students = await Student.find(query)
    .sort(sortBy)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  const total = await Student.countDocuments(query);

  res.json({
    success: true,
    students: students.map(sanitizeStudent),
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

// Get single student
router.get('/:id', protect, asyncHandler(async (req, res) => {
  const student = await Student.findOne({
    _id: req.params.id,
    userId: req.user._id
  }).lean();

  if (!student) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.STUDENT_NOT_FOUND 
    });
  }

  res.json({
    success: true,
    student: sanitizeStudent(student)
  });
}));

// Upload students in bulk
router.post('/upload', protect, validateStudentRequest, validateBulkUpload, asyncHandler(async (req, res) => {
  const { students } = req.body;

  // Prepare students for insertion
  const studentsWithUser = students.map(student => ({
    name: student.name.trim(),
    usn: student.usn.trim().toUpperCase(),
    email: student.email.trim().toLowerCase(),
    branch: student.branch?.trim() || '',
    year: student.year?.toString() || '',
    semester: student.semester?.toString() || '',
    userId: req.user._id
  }));

  // Validate USN and email formats
  const validationErrors = [];
  studentsWithUser.forEach((student, index) => {
    if (!validateUSN(student.usn)) {
      validationErrors.push(`Student "${student.name}" has invalid USN format`);
    }
    if (!validateEmail(student.email)) {
      validationErrors.push(`Student "${student.name}" has invalid email format`);
    }
  });

  if (validationErrors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: validationErrors
    });
  }

  // Check for duplicate USNs or emails within the upload batch
  const usnSet = new Set();
  const emailSet = new Set();
  const duplicates = [];

  studentsWithUser.forEach(student => {
    if (usnSet.has(student.usn)) {
      duplicates.push(`Duplicate USN: ${student.usn}`);
    }
    if (emailSet.has(student.email)) {
      duplicates.push(`Duplicate email: ${student.email}`);
    }
    usnSet.add(student.usn);
    emailSet.add(student.email);
  });

  if (duplicates.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Duplicate entries found',
      errors: duplicates
    });
  }

  // Check for existing USNs or emails in database
  const existingUSNs = await Student.find({ 
    usn: { $in: studentsWithUser.map(s => s.usn) },
    userId: req.user._id 
  }).select('usn').lean();

  const existingEmails = await Student.find({ 
    email: { $in: studentsWithUser.map(s => s.email) },
    userId: req.user._id 
  }).select('email').lean();

  if (existingUSNs.length > 0 || existingEmails.length > 0) {
    const conflicts = [
      ...existingUSNs.map(s => `USN already exists: ${s.usn}`),
      ...existingEmails.map(s => `Email already exists: ${s.email}`)
    ];

    return res.status(409).json({
      success: false,
      message: 'Some students already exist',
      conflicts
    });
  }

  // Insert students
  const result = await Student.insertMany(studentsWithUser, { 
    ordered: false,
    rawResult: true 
  });

  res.status(201).json({
    success: true,
    message: `Successfully uploaded ${result.insertedCount} students`,
    count: result.insertedCount,
    students: result.ops ? result.ops.map(sanitizeStudent) : []
  });
}));

// Create single student
router.post('/', protect, validateStudentRequest, asyncHandler(async (req, res) => {
  const { name, usn, email, branch, year, semester } = req.body;

  // Validate required fields
  if (!name || !name.trim()) {
    return res.status(400).json({ 
      success: false, 
      message: 'Student name is required' 
    });
  }

  if (!usn || !usn.trim()) {
    return res.status(400).json({ 
      success: false, 
      message: 'USN is required' 
    });
  }

  if (!email || !email.trim()) {
    return res.status(400).json({ 
      success: false, 
      message: 'Email is required' 
    });
  }

  // Validate formats
  if (!validateUSN(usn.trim())) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid USN format' 
    });
  }

  if (!validateEmail(email.trim())) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid email format' 
    });
  }

  // Check for existing student with same USN or email
  const existingStudent = await Student.findOne({
    $or: [
      { usn: usn.trim().toUpperCase(), userId: req.user._id },
      { email: email.trim().toLowerCase(), userId: req.user._id }
    ]
  });

  if (existingStudent) {
    return res.status(409).json({ 
      success: false, 
      message: 'Student with this USN or email already exists' 
    });
  }

  const student = await Student.create({
    name: name.trim(),
    usn: usn.trim().toUpperCase(),
    email: email.trim().toLowerCase(),
    branch: branch?.trim() || '',
    year: year?.toString() || '',
    semester: semester?.toString() || '',
    userId: req.user._id
  });

  res.status(201).json({
    success: true,
    student: sanitizeStudent(student)
  });
}));

// Update student
router.put('/:id', protect, validateStudentRequest, asyncHandler(async (req, res) => {
  const { name, usn, email, branch, year, semester } = req.body;

  // Build update object
  const updateData = {};
  if (name !== undefined) updateData.name = name.trim();
  if (usn !== undefined) updateData.usn = usn.trim().toUpperCase();
  if (email !== undefined) updateData.email = email.trim().toLowerCase();
  if (branch !== undefined) updateData.branch = branch?.trim() || '';
  if (year !== undefined) updateData.year = year?.toString() || '';
  if (semester !== undefined) updateData.semester = semester?.toString() || '';

  // Validate formats if provided
  if (usn && !validateUSN(updateData.usn)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid USN format' 
    });
  }

  if (email && !validateEmail(updateData.email)) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid email format' 
    });
  }

  // Check for conflicts with other students
  if (usn || email) {
    const conflictQuery = {
      _id: { $ne: req.params.id },
      userId: req.user._id,
      $or: []
    };

    if (usn) conflictQuery.$or.push({ usn: updateData.usn });
    if (email) conflictQuery.$or.push({ email: updateData.email });

    if (conflictQuery.$or.length > 0) {
      const existingStudent = await Student.findOne(conflictQuery);
      if (existingStudent) {
        return res.status(409).json({ 
          success: false, 
          message: 'Another student with this USN or email already exists' 
        });
      }
    }
  }

  const student = await Student.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    updateData,
    { new: true, runValidators: true }
  );

  if (!student) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.STUDENT_NOT_FOUND 
    });
  }

  res.json({
    success: true,
    student: sanitizeStudent(student)
  });
}));

// Delete student
router.delete('/:id', protect, asyncHandler(async (req, res) => {
  const student = await Student.findOneAndDelete({
    _id: req.params.id,
    userId: req.user._id
  });

  if (!student) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.STUDENT_NOT_FOUND 
    });
  }

  res.json({
    success: true,
    message: 'Student deleted successfully',
    deletedId: student._id
  });
}));

// Bulk delete students
router.delete('/', protect, validateStudentRequest, asyncHandler(async (req, res) => {
  const { studentIds } = req.body;

  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'studentIds array is required' 
    });
  }

  const result = await Student.deleteMany({
    _id: { $in: studentIds },
    userId: req.user._id
  });

  if (result.deletedCount === 0) {
    return res.status(404).json({ 
      success: false, 
      message: 'No students found to delete' 
    });
  }

  res.json({
    success: true,
    message: `${result.deletedCount} student(s) deleted successfully`
  });
}));

// Health check endpoint
router.get('/health', protect, (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Students service is healthy',
    timestamp: new Date().toISOString(),
    userId: req.user._id
  });
});

module.exports = router;