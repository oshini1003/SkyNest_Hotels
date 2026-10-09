const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/roomController');
const { authenticate, requireRole } = require('../middleware/auth');

// Branches
router.get('/branches', ctrl.listBranches);
router.post('/branches', authenticate, requireRole('Admin', 'Manager'), ctrl.createBranch);
router.put('/branches/:id', authenticate, requireRole('Admin', 'Manager'), ctrl.updateBranch);
router.delete('/branches/:id', authenticate, requireRole('Admin', 'Manager'), ctrl.deleteBranch);

// Room types
router.get('/room-types', ctrl.listRoomTypes);
router.post('/room-types', authenticate, requireRole('Admin', 'Manager'), ctrl.createRoomType);
router.put('/room-types/:id', authenticate, requireRole('Admin', 'Manager'), ctrl.updateRoomType);
router.delete('/room-types/:id', authenticate, requireRole('Admin', 'Manager'), ctrl.deleteRoomType);

// Amenities
router.get('/amenities', ctrl.listAmenities);
router.post('/amenities', authenticate, requireRole('Admin', 'Manager'), ctrl.createAmenity);
router.put('/amenities/:id', authenticate, requireRole('Admin', 'Manager'), ctrl.updateAmenity);
router.delete('/amenities/:id', authenticate, requireRole('Admin', 'Manager'), ctrl.deleteAmenity);

// Rooms (GET is public so guests can search availability without logging in)
router.get('/rooms', ctrl.searchRooms);
router.post('/rooms', authenticate, requireRole('Admin', 'Manager'), ctrl.createRoom);
router.put('/rooms/:id', authenticate, requireRole('Admin', 'Manager'), ctrl.updateRoom);
router.delete('/rooms/:id', authenticate, requireRole('Admin', 'Manager'), ctrl.deleteRoom);
router.patch('/rooms/:id/status', authenticate, require('../middleware/staffScope'), requireRole('Admin', 'Manager', 'Receptionist'), ctrl.updateRoomStatus);

module.exports = router;