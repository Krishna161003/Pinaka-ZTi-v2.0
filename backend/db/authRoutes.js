const express = require('express');
const router = express.Router();
const db = require('./db'); // Assuming you have a database connection module
const verifyToken = require('./authMiddleware');

// Check authentication status endpoint
router.get('/checkAuth', verifyToken, (req, res) => {
  res.json({ isAuthenticated: true, userId: req.userId, companyName: req.companyName });
});

module.exports = router;
