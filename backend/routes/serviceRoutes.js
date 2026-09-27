const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/serviceController');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/services', ctrl.listServices);
router.post('/services', authenticate, requireRole('Admin', 'Manager'), ctrl.createService);
router.put('/services/:id', authenticate, requireRole('Admin', 'Manager'), ctrl.updateService);

router.post('/service-usage', authenticate, ctrl.logServiceUsage);
router.get('/service-usage/:bookingId', authenticate, ctrl.listServiceUsageForBooking);

module.exports = router;
