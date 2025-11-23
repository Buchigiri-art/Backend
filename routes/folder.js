const express = require('express');
const Folder = require('../models/Folder');
const Bookmark = require('../models/Bookmark');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Constants
const ERROR_MESSAGES = {
  FOLDER_NOT_FOUND: 'Folder not found',
  INVALID_REQUEST: 'Invalid request body',
  FOLDER_NAME_REQUIRED: 'Folder name is required',
  SERVER_ERROR: 'Internal server error'
};

// Validation
const validateFolderRequest = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.INVALID_REQUEST 
    });
  }
  next();
};

// Helper: sanitize folder data
const sanitizeFolder = (folder) => ({
  id: folder._id || folder.id,
  name: folder.name,
  description: folder.description,
  color: folder.color,
  userId: folder.userId,
  bookmarkCount: folder.bookmarkCount || 0,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt
});

// Get all folders with bookmark counts
router.get('/', protect, asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 50, 
    sortBy = '-createdAt' 
  } = req.query;

  const folders = await Folder.find({ userId: req.user._id })
    .sort(sortBy)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  // Get bookmark counts for each folder
  const foldersWithCounts = await Promise.all(
    folders.map(async (folder) => {
      const bookmarkCount = await Bookmark.countDocuments({ 
        folderId: folder._id, 
        userId: req.user._id 
      });
      return { ...folder, bookmarkCount };
    })
  );

  const total = await Folder.countDocuments({ userId: req.user._id });

  res.json({ 
    success: true, 
    folders: foldersWithCounts.map(sanitizeFolder),
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

// Get single folder with bookmarks
router.get('/:id', protect, asyncHandler(async (req, res) => {
  const folder = await Folder.findOne({
    _id: req.params.id,
    userId: req.user._id
  }).lean();

  if (!folder) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.FOLDER_NOT_FOUND 
    });
  }

  // Get bookmarks in this folder
  const bookmarks = await Bookmark.find({
    folderId: folder._id,
    userId: req.user._id
  }).populate('folderId', 'name color').lean();

  const folderWithBookmarks = {
    ...folder,
    bookmarks,
    bookmarkCount: bookmarks.length
  };

  res.json({ 
    success: true, 
    folder: sanitizeFolder(folderWithBookmarks) 
  });
}));

// Create folder
router.post('/', protect, validateFolderRequest, asyncHandler(async (req, res) => {
  const { name, description, color } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.FOLDER_NAME_REQUIRED 
    });
  }

  // Check for duplicate folder names (case insensitive)
  const existingFolder = await Folder.findOne({
    name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
    userId: req.user._id
  });

  if (existingFolder) {
    return res.status(409).json({ 
      success: false, 
      message: 'Folder with this name already exists' 
    });
  }

  const folder = await Folder.create({
    name: name.trim(),
    description: description ? description.trim() : '',
    color: color || '#3B82F6', // Default blue color
    userId: req.user._id
  });

  res.status(201).json({ 
    success: true, 
    folder: sanitizeFolder(folder) 
  });
}));

// Update folder
router.put('/:id', protect, validateFolderRequest, asyncHandler(async (req, res) => {
  const { name, description, color } = req.body;

  // Build update object
  const updateData = {};
  if (name !== undefined) {
    if (!name.trim()) {
      return res.status(400).json({ 
        success: false, 
        message: ERROR_MESSAGES.FOLDER_NAME_REQUIRED 
      });
    }
    updateData.name = name.trim();
  }
  if (description !== undefined) updateData.description = description.trim();
  if (color !== undefined) updateData.color = color;

  // Check for duplicate folder names if name is being updated
  if (name) {
    const existingFolder = await Folder.findOne({
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      userId: req.user._id,
      _id: { $ne: req.params.id }
    });

    if (existingFolder) {
      return res.status(409).json({ 
        success: false, 
        message: 'Folder with this name already exists' 
      });
    }
  }

  const folder = await Folder.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    updateData,
    { 
      new: true, 
      runValidators: true 
    }
  );

  if (!folder) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.FOLDER_NOT_FOUND 
    });
  }

  res.json({ 
    success: true, 
    folder: sanitizeFolder(folder) 
  });
}));

// Delete folder and move bookmarks to null (or optionally delete them)
router.delete('/:id', protect, asyncHandler(async (req, res) => {
  const { moveBookmarksTo } = req.query;

  const folder = await Folder.findOne({
    _id: req.params.id,
    userId: req.user._id
  });

  if (!folder) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.FOLDER_NOT_FOUND 
    });
  }

  // Handle bookmarks in the folder
  if (moveBookmarksTo) {
    // Move bookmarks to another folder
    await Bookmark.updateMany(
      { folderId: folder._id, userId: req.user._id },
      { folderId: moveBookmarksTo }
    );
  } else {
    // Remove folder reference from bookmarks (set to null)
    await Bookmark.updateMany(
      { folderId: folder._id, userId: req.user._id },
      { $unset: { folderId: 1 } }
    );
  }

  // Delete the folder
  await Folder.findByIdAndDelete(folder._id);

  res.json({ 
    success: true, 
    message: 'Folder deleted successfully',
    deletedId: folder._id 
  });
}));

// Get folder statistics
router.get('/:id/stats', protect, asyncHandler(async (req, res) => {
  const folder = await Folder.findOne({
    _id: req.params.id,
    userId: req.user._id
  });

  if (!folder) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.FOLDER_NOT_FOUND 
    });
  }

  const bookmarkCount = await Bookmark.countDocuments({
    folderId: folder._id,
    userId: req.user._id
  });

  const recentBookmarks = await Bookmark.find({
    folderId: folder._id,
    userId: req.user._id
  })
    .sort('-createdAt')
    .limit(5)
    .lean();

  res.json({
    success: true,
    stats: {
      folder: sanitizeFolder(folder),
      bookmarkCount,
      recentBookmarks: recentBookmarks.map(bookmark => ({
        id: bookmark._id,
        title: bookmark.title,
        url: bookmark.url,
        createdAt: bookmark.createdAt
      }))
    }
  });
}));

// Health check endpoint
router.get('/health', protect, (req, res) => {
  res.status(200).json({ 
    success: true, 
    message: 'Folders service is healthy',
    timestamp: new Date().toISOString(),
    userId: req.user._id
  });
});

module.exports = router;