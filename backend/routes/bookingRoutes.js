const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/bookingController');
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate); // every booking action requires a logged-in guest or staff member

router.get('/', ctrl.listBookings);
router.get('/:id', ctrl.getBooking);
router.post('/', ctrl.makeBooking); // guest self-service OR front desk on the guest's behalf
router.patch('/:id/cancel', ctrl.cancelBooking);
router.post('/:id/check-in', requireRole('Receptionist', 'Manager', 'Admin'), ctrl.checkIn);
router.post('/:id/check-out', requireRole('Receptionist', 'Manager', 'Admin'), ctrl.checkOut);

module.exports = router;
