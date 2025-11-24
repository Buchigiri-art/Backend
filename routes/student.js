// server/routes/students.js
const express = require('express');
const Student = require('../models/Student');
const { protect } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/students
 * Create a single student manually
 */
router.post('/', protect, async (req, res) => {
  try {
    const { name, usn, email, branch, year, semester } = req.body;

    if (!name || !usn || !email) {
      return res
        .status(400)
        .json({ message: 'Name, USN and Email are required' });
    }

    const student = await Student.create({
      userId: req.user._id,
      name: String(name).trim(),
      usn: String(usn).trim(),
      email: String(email).trim().toLowerCase(),
      branch: branch || '',
      year: year || '',
      semester: semester || '',
    });

    return res.status(201).json(student);
  } catch (error) {
    console.error('POST /students error:', error);
    res.status(400).json({ message: error.message || 'Failed to create student' });
  }
});

// Get all students
router.get('/all', protect, async (req, res) => {
  try {
    const students = await Student.find({ userId: req.user._id }).sort('-createdAt');
    res.json(students);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Upload students (bulk)
router.post('/upload', protect, async (req, res) => {
  try {
    const { students } = req.body;

    const studentsWithUser = students.map((student) => ({
      ...student,
      userId: req.user._id,
    }));

    await Student.insertMany(studentsWithUser);

    res.json({ success: true, count: students.length });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update student
router.put('/:id', protect, async (req, res) => {
  try {
    const { name, usn, email, branch, year, semester } = req.body;

    const update = { name, usn, email, branch, year, semester };

    Object.keys(update).forEach((key) => {
      if (update[key] === undefined) {
        delete update[key];
      }
    });

    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      update,
      { new: true }
    );

    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }

    res.json(student);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete student
router.delete('/:id', protect, async (req, res) => {
  try {
    const student = await Student.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    res.json({ success: true, message: 'Student deleted' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
