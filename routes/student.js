// server/routes/students.js (or wherever this lives)
const express = require('express');
const Student = require('../models/Student');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Get all students
router.get('/all', protect, async (req, res) => {
  try {
    const students = await Student.find({ userId: req.user._id }).sort('-createdAt');
    res.json(students);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Upload students
router.post('/upload', protect, async (req, res) => {
  try {
    const { students } = req.body;
    
    const studentsWithUser = students.map(student => ({
      ...student,
      userId: req.user._id
    }));

    await Student.insertMany(studentsWithUser);
    
    res.json({ success: true, count: students.length });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// ✅ Update student
router.put('/:id', protect, async (req, res) => {
  try {
    const { name, usn, email, branch, year, semester } = req.body;

    const update = { name, usn, email, branch, year, semester };

    // remove undefined fields so we don't overwrite with undefined
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
      userId: req.user._id
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
