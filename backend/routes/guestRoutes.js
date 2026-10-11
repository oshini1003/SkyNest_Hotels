const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/guestController');
const { authenticate, requireGuest, requireRole } = require('../middleware/auth');
const staffScope = require('../middleware/staffScope');

// All guest profile routes require authentication + guest role
router.get('/me', authenticate, requireGuest, ctrl.getProfile);
router.put('/me', authenticate, requireGuest, ctrl.updateProfile);

// Current staff identity and assignment are verified before guest access.
router.get('/', authenticate, staffScope, requireRole('Receptionist', 'Manager', 'Admin'), ctrl.searchGuests);
router.post('/', authenticate, staffScope, requireRole('Receptionist', 'Manager', 'Admin'), ctrl.createGuest);

module.exports = router;

