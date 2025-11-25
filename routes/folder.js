// backend/routes/folders.js
const express = require('express');
const Folder = require('../models/Folder');
const { protect } = require('../middleware/auth');

const router = express.Router();

// Get all folders for user
router.get('/', protect, async (req, res) => {
  try {
    const folders = await Folder.find({ userId: req.user._id })
      .sort('-createdAt')
      .lean();
    res.json({ success: true, folders });
  } catch (error) {
    console.error('GET /folders error:', error);
    res
      .status(500)
      .json({ message: 'Failed to fetch folders. Please try again.' });
  }
});

// Create folder
router.post('/', protect, async (req, res) => {
  try {
    const folder = await Folder.create({
      ...req.body,
      userId: req.user._id,
    });
    res.status(201).json({ success: true, folder });
  } catch (error) {
    console.error('POST /folders error:', error);
    res
      .status(400)
      .json({ message: error.message || 'Failed to create folder' });
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
    console.error('PUT /folders/:id error:', error);
    res
      .status(400)
      .json({ message: error.message || 'Failed to update folder' });
  }
});

// Delete folder
router.delete('/:id', protect, async (req, res) => {
  try {
    const folder = await Folder.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!folder) {
      return res.status(404).json({ message: 'Folder not found' });
    }
    res.json({ success: true, message: 'Folder deleted' });
  } catch (error) {
    console.error('DELETE /folders/:id error:', error);
    res
      .status(500)
      .json({ message: 'Failed to delete folder. Please try again.' });
  }
});

module.exports = router;
