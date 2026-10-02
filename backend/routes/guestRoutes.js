const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/guestController');
const { authenticate, requireGuest } = require('../middleware/auth');

// All guest profile routes require authentication + guest role
router.get('/me', authenticate, requireGuest, ctrl.getProfile);
router.put('/me', authenticate, requireGuest, ctrl.updateProfile);

module.exports = router;

