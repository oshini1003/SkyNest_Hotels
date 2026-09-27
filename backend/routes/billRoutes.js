const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/billController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/bookings/:bookingId/bill', authenticate, ctrl.getBill);
router.post('/payments', authenticate, requireRole('Receptionist', 'Manager', 'Admin'), ctrl.processPayment);

module.exports = router;
