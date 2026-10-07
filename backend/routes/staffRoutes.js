const express = require('express');
const { authenticate, requireStaff } = require('../middleware/auth');
const resolveStaffScope = require('../middleware/staffScope');
const router = express.Router();
router.get('/scope', authenticate, requireStaff, resolveStaffScope, (req, res) => res.json(req.staffScope));
module.exports = router;
