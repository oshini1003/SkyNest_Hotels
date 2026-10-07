const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/roomController');
const { authenticate, requireRole } = require('../middleware/auth');

// Branches
router.get('/branches', ctrl.listBranches);
router.post('/branches', authenticate, requireRole('Admin', 'Manager'), ctrl.createBranch);

// Room types
router.get('/room-types', ctrl.listRoomTypes);
router.post('/room-types', authenticate, requireRole('Admin', 'Manager'), ctrl.createRoomType);

// Amenities
router.get('/amenities', ctrl.listAmenities);
router.post('/amenities', authenticate, requireRole('Admin', 'Manager'), ctrl.createAmenity);

// Rooms (GET is public so guests can search availability without logging in)
router.get('/rooms', ctrl.searchRooms);
router.post('/rooms', authenticate, requireRole('Admin', 'Manager'), ctrl.createRoom);
router.patch('/rooms/:id/status', authenticate, require('../middleware/staffScope'), requireRole('Admin', 'Manager', 'Receptionist'), ctrl.updateRoomStatus);

module.exports = router;
