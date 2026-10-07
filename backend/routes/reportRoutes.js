const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reportController');
const { authenticate, requireRole } = require('../middleware/auth');
const resolveStaffScope = require('../middleware/staffScope');

router.use(authenticate, requireRole('Manager', 'Admin'), resolveStaffScope);

router.get('/occupancy', ctrl.occupancyReport);
router.get('/billing-summary', ctrl.billingSummary);
router.get('/service-usage', ctrl.serviceUsageBreakdown);
router.get('/revenue', ctrl.monthlyRevenueByBranch);
router.get('/top-services', ctrl.topServices);

module.exports = router;
