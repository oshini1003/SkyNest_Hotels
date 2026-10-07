const pool = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const { staffRoles, restrictedRoles, canonicalId, expired, forbidden } = require('../utils/staffScope');

// The token proves identity; the current database account determines access.
// This middleware belongs after authenticate and before route role checks.
module.exports = asyncHandler(async (req, res, next) => {
  if (req.user?.type === 'guest') return next();
  if (req.user?.type !== 'staff' || !canonicalId(req.user.id) || !staffRoles.has(req.user.role)
      || !Object.hasOwn(req.user, 'branchId')
      || (req.user.branchId !== null && !canonicalId(req.user.branchId))) return expired(res);
  const [[staff]] = await pool.execute(
    `SELECT s.StaffID, s.Role, s.BranchID, b.Name AS BranchName
     FROM STAFF s JOIN STAFF_ACCOUNT a ON a.StaffID = s.StaffID
     LEFT JOIN BRANCH b ON b.BranchID = s.BranchID WHERE s.StaffID = ?`, [req.user.id]);
  if (!staff || !canonicalId(staff.StaffID) || !staffRoles.has(staff.Role)
      || staff.StaffID !== req.user.id || staff.Role !== req.user.role
      || staff.BranchID !== req.user.branchId) return expired(res);
  if ((staff.BranchID !== null && (!canonicalId(staff.BranchID) || typeof staff.BranchName !== 'string' || !staff.BranchName.trim()))
      || (restrictedRoles.has(staff.Role) && staff.BranchID === null)) return forbidden(res);
  req.staffScope = Object.freeze({ staffId: staff.StaffID, role: staff.Role,
    branchId: staff.BranchID, branchName: staff.BranchID === null ? null : staff.BranchName });
  next();
});
