const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/billController');
const resolveStaffScope = require('../middleware/staffScope');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/bookings/:bookingId/bill', authenticate, resolveStaffScope, ctrl.getBill);
router.post('/payments', authenticate, resolveStaffScope, requireRole('Receptionist', 'Manager', 'Admin'), ctrl.processPayment);

module.exports = router;
