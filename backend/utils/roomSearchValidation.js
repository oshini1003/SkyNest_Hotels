const integerFields = ['roomId', 'branchId', 'roomTypeId', 'guestCount'];
const maxSqlInteger = 2147483647;

function localDateString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateRoomSearch(query, now = new Date()) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return { error: 'Invalid room search filters.' };
  }

  const value = {};
  for (const field of integerFields) {
    if (query[field] === undefined) continue;
    const raw = query[field];
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw) || Number(raw) > maxSqlInteger) {
      return { error: `${field} must be a positive whole number no greater than ${maxSqlInteger}.` };
    }
    value[field] = Number(raw);
  }

  const hasCheckin = query.checkin !== undefined;
  const hasCheckout = query.checkout !== undefined;
  if (hasCheckin !== hasCheckout) {
    return { error: 'Provide both checkin and checkout dates.' };
  }
  if (hasCheckin) {
    if (!isCalendarDate(query.checkin) || !isCalendarDate(query.checkout)) {
      return { error: 'checkin and checkout must be valid dates in YYYY-MM-DD format.' };
    }
    if (query.checkin < localDateString(now)) {
      return { error: 'Check-in must be today or a future date.' };
    }
    if (query.checkout <= query.checkin) {
      return { error: 'Check-out must be after check-in.' };
    }
    value.checkin = query.checkin;
    value.checkout = query.checkout;
  }

  return { value };
}

module.exports = { validateRoomSearch };
