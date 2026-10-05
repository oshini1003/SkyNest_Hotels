const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboardController');
const { authenticate, requireRole } = require('../middleware/auth');

// GET /api/dashboard/admin (or /dashboard/admin)
// Restricted to Administrator and Manager roles
router.get('/admin', authenticate, requireRole('Admin', 'Manager'), ctrl.getAdminDashboardSummary);

module.exports = router;

