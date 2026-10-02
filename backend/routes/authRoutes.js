const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { authenticate, requireRole, requireGuest, requireStaff } = require('../middleware/auth');

router.post('/guest/register', ctrl.registerGuest);
router.post('/guest/login', ctrl.loginGuest);
router.post('/staff/login', ctrl.loginStaff);

// Only an Admin can create new staff accounts
router.post('/staff/register', authenticate, requireRole('Admin'), ctrl.registerStaff);

router.put('/guest/password', authenticate, requireGuest, ctrl.changeGuestPassword);
router.put('/staff/password', authenticate, requireStaff, ctrl.changeStaffPassword);

router.post('/refresh', ctrl.refreshToken);
router.post('/logout', ctrl.logout);

module.exports = router;
