const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/serviceController');
const resolveStaffScope = require('../middleware/staffScope');
const { authenticate, requireRole } = require('../middleware/auth');

router.get('/services', ctrl.listServices);
router.get('/management/services', authenticate, resolveStaffScope, requireRole('Admin', 'Manager'), ctrl.listManagedServices);
router.post('/services', authenticate, resolveStaffScope, requireRole('Admin', 'Manager'), ctrl.createService);
router.put('/services/:id', authenticate, resolveStaffScope, requireRole('Admin', 'Manager'), ctrl.updateService);

router.post('/service-usage', authenticate, resolveStaffScope, ctrl.logServiceUsage);
router.get('/service-usage/:bookingId', authenticate, resolveStaffScope, ctrl.listServiceUsageForBooking);

module.exports = router;
