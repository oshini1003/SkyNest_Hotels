const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/guest/register', ctrl.registerGuest);
router.post('/guest/login', ctrl.loginGuest);
router.post('/staff/login', ctrl.loginStaff);

// Only an Admin can create new staff accounts
router.post('/staff/register', authenticate, requireRole('Admin'), ctrl.registerStaff);

module.exports = router;
