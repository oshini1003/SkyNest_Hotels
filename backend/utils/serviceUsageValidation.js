const MAX_SQL_INT = 2147483647;
const serviceRoles = new Set(['Admin', 'Manager', 'Receptionist', 'ServiceStaff']);

function positiveInteger(raw) {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= MAX_SQL_INT ? value : null;
}

function canLogServiceUsage(user) {
  return !!user && positiveInteger(user.id) !== null
    && (user.type === 'guest' || (user.type === 'staff' && serviceRoles.has(user.role)));
}

function validateServiceUsage(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Provide bookingId, serviceId and quantity.' };
  }
  const value = {};
  // Only these fields reach the procedure. Guest identity comes from the token;
  // the database captures the active catalogue price at insertion time.
  for (const field of ['bookingId', 'serviceId', 'quantity']) {
    const parsed = positiveInteger(body[field]);
    if (parsed === null) {
      return { error: `${field} must be a positive whole number no greater than ${MAX_SQL_INT}.` };
    }
    value[field] = parsed;
  }
  return { value };
}

module.exports = { positiveInteger, canLogServiceUsage, validateServiceUsage };
