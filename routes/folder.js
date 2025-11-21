const express = require('express');
const Folder = require('../models/Folder');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Get all folders for user
router.get('/', protect, async (req, res) => {
  try {
    const folders = await Folder.find({ userId: req.user._id }).sort('-createdAt');
    res.json({ success: true, folders });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Create folder
router.post('/', protect, async (req, res) => {
  try {
    const folder = await Folder.create({
      ...req.body,
      userId: req.user._id
    });
    res.status(201).json({ success: true, folder });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Update folder
router.put('/:id', protect, async (req, res) => {
  try {
    const folder = await Folder.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }
    res.json({ success: true, folder });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Delete folder
router.delete('/:id', protect, async (req, res) => {
  try {
    const folder = await Folder.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id
    });
    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }
    res.json({ success: true, message: 'Folder deleted' });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

module.exports = router;
