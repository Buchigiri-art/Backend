const express = require('express');
const Bookmark = require('../models/Bookmark');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Constants
const ERROR_MESSAGES = {
  BOOKMARK_NOT_FOUND: 'Bookmark not found',
  INVALID_REQUEST: 'Invalid request body',
  SERVER_ERROR: 'Internal server error'
};

// Validation
const validateBookmarkRequest = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ 
      success: false, 
      message: ERROR_MESSAGES.INVALID_REQUEST 
    });
  }
  next();
};

// Helper: sanitize bookmark data
const sanitizeBookmark = (bookmark) => ({
  id: bookmark._id || bookmark.id,
  title: bookmark.title,
  url: bookmark.url,
  description: bookmark.description,
  folderId: bookmark.folderId,
  userId: bookmark.userId,
  tags: bookmark.tags || [],
  createdAt: bookmark.createdAt,
  updatedAt: bookmark.updatedAt
});

// Get all bookmarks with pagination and filtering
router.get('/', protect, asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    limit = 50, 
    folderId, 
    search,
    sortBy = '-createdAt' 
  } = req.query;

  // Build query
  const query = { userId: req.user._id };
  
  if (folderId) {
    query.folderId = folderId;
  }
  
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { url: { $regex: search, $options: 'i' } }
    ];
  }

  // Execute query with pagination
  const bookmarks = await Bookmark.find(query)
    .populate('folderId', 'name color')
    .sort(sortBy)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

  // Get total count for pagination info
  const total = await Bookmark.countDocuments(query);

  res.json({ 
    success: true, 
    bookmarks: bookmarks.map(sanitizeBookmark),
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
}));

// Get single bookmark
router.get('/:id', protect, asyncHandler(async (req, res) => {
  const bookmark = await Bookmark.findOne({
    _id: req.params.id,
    userId: req.user._id
  }).populate('folderId', 'name color');

  if (!bookmark) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.BOOKMARK_NOT_FOUND 
    });
  }

  res.json({ 
    success: true, 
    bookmark: sanitizeBookmark(bookmark) 
  });
}));

// Create bookmark
router.post('/', protect, validateBookmarkRequest, asyncHandler(async (req, res) => {
  const { title, url, description, folderId, tags } = req.body;

  // Validate required fields
  if (!title || !title.trim()) {
    return res.status(400).json({ 
      success: false, 
      message: 'Title is required' 
    });
  }

  if (!url || !url.trim()) {
    return res.status(400).json({ 
      success: false, 
      message: 'URL is required' 
    });
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch (error) {
    return res.status(400).json({ 
      success: false, 
      message: 'Invalid URL format' 
    });
  }

  const bookmark = await Bookmark.create({
    title: title.trim(),
    url: url.trim(),
    description: description ? description.trim() : '',
    folderId: folderId || null,
    tags: Array.isArray(tags) ? tags : [],
    userId: req.user._id
  });

  await bookmark.populate('folderId', 'name color');

  res.status(201).json({ 
    success: true, 
    bookmark: sanitizeBookmark(bookmark) 
  });
}));

// Update bookmark
router.put('/:id', protect, validateBookmarkRequest, asyncHandler(async (req, res) => {
  const { title, url, description, folderId, tags } = req.body;

  // Build update object
  const updateData = {};
  if (title !== undefined) updateData.title = title.trim();
  if (url !== undefined) updateData.url = url.trim();
  if (description !== undefined) updateData.description = description.trim();
  if (folderId !== undefined) updateData.folderId = folderId;
  if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [];

  // URL validation if provided
  if (url) {
    try {
      new URL(url);
    } catch (error) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid URL format' 
      });
    }
  }

  const bookmark = await Bookmark.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    updateData,
    { 
      new: true, 
      runValidators: true 
    }
  ).populate('folderId', 'name color');

  if (!bookmark) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.BOOKMARK_NOT_FOUND 
    });
  }

  res.json({ 
    success: true, 
    bookmark: sanitizeBookmark(bookmark) 
  });
}));

// Delete bookmark
router.delete('/:id', protect, asyncHandler(async (req, res) => {
  const bookmark = await Bookmark.findOneAndDelete({
    _id: req.params.id,
    userId: req.user._id
  });

  if (!bookmark) {
    return res.status(404).json({ 
      success: false, 
      message: ERROR_MESSAGES.BOOKMARK_NOT_FOUND 
    });
  }

  res.json({ 
    success: true, 
    message: 'Bookmark deleted successfully',
    deletedId: bookmark._id 
  });
}));

// Bulk delete bookmarks
router.delete('/', protect, validateBookmarkRequest, asyncHandler(async (req, res) => {
  const { bookmarkIds } = req.body;

  if (!Array.isArray(bookmarkIds) || bookmarkIds.length === 0) {
    return res.status(400).json({ 
      success: false, 
      message: 'bookmarkIds array is required' 
    });
  }

  const result = await Bookmark.deleteMany({
    _id: { $in: bookmarkIds },
    userId: req.user._id
  });

  if (result.deletedCount === 0) {
    return res.status(404).json({ 
      success: false, 
      message: 'No bookmarks found to delete' 
    });
  }

  res.json({ 
    success: true, 
    message: `${result.deletedCount} bookmark(s) deleted successfully` 
  });
}));

// Health check endpoint
router.get('/health', protect, (req, res) => {
  res.status(200).json({ 
    success: true, 
    message: 'Bookmarks service is healthy',
    timestamp: new Date().toISOString(),
    userId: req.user._id
  });
});

module.exports = router;