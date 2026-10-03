const { validateRoomSearch } = require('./roomSearchValidation');

const paymentMethods = new Set(['Cash', 'Card', 'Bank Transfer']);
const bookingStatuses = new Set(['Booked', 'Checked-In', 'Checked-Out', 'Cancelled']);

function positiveInteger(raw) {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : null;
}

function validateBooking(body, user, now = new Date()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Provide the room, stay dates, guest count and payment preference.' };
  }
  const value = {};
  const fields = { roomId: body.roomId, guestCount: body.guestCount };
  // Guests cannot book under an ID supplied by the browser.
  fields.guestId = user.type === 'guest' ? user.id : body.guestId;
  for (const [field, raw] of Object.entries(fields)) {
    const number = positiveInteger(raw);
    if (number === null) return { error: `${field} must be a positive whole number no greater than 2147483647.` };
    value[field] = number;
  }
  if (body.checkin === undefined || body.checkout === undefined) {
    return { error: 'Provide both checkin and checkout dates.' };
  }
  const stay = validateRoomSearch({ checkin: body.checkin, checkout: body.checkout }, now);
  if (stay.error) return stay;
  if (!paymentMethods.has(body.paymentMethod)) return { error: 'Choose Cash, Card or Bank Transfer.' };
  return { value: { ...value, ...stay.value, paymentMethod: body.paymentMethod } };
}

function validateBookingFilters(query, user) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return { error: 'Invalid booking filters.' };
  const value = {};
  for (const field of ['bookingId', 'guestId', 'branchId']) {
    if (field === 'guestId' && user.type === 'guest') continue;
    if (query[field] === undefined) continue;
    // Query parameters must be canonical strings, unlike JSON body integers.
    const parsed = typeof query[field] === 'string' ? positiveInteger(query[field]) : null;
    if (parsed === null) return { error: `${field} must be a positive whole number no greater than 2147483647.` };
    value[field] = parsed;
  }
  if (query.status !== undefined) {
    if (!bookingStatuses.has(query.status)) return { error: 'Choose a valid booking status.' };
    value.status = query.status;
  }
  for (const field of ['guestName', 'idNumber']) {
    if (query[field] === undefined) continue;
    if (typeof query[field] !== 'string' || query[field].length > 255) return { error: `${field} must be text no longer than 255 characters.` };
    if (query[field].trim()) value[field] = query[field].trim();
  }
  return { value };
}

// Use the database calendar date, not the browser/server JavaScript timezone.
// This is an arrival-window rule; time-of-day policies are not configured here.
function checkInEligibility(booking, rooms, today) {
  let reason = null;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;
  if (booking.BookingStatus !== 'Booked') {
    reason = 'Only a Booked reservation can be checked in.';
  } else if (!rooms.length) {
    reason = 'This booking has no rooms.';
  } else if (!isoDate.test(today) || rooms.some(room => !isoDate.test(room.CheckInDate) || !isoDate.test(room.CheckOutDate))) {
    reason = 'The stay dates could not be verified. Please refresh and try again.';
  } else if (rooms.some(room => today < room.CheckInDate)) {
    reason = 'Check-in is available from the reserved arrival date.';
  } else if (rooms.some(room => today >= room.CheckOutDate)) {
    reason = 'The reserved stay has ended. Check-in must be before the checkout date.';
  } else if (rooms.some(room => room.RoomStatus !== 'Available')) {
    reason = 'Every room must be Available before check-in.';
  }
  return { allowed: reason === null, reason, today };
}

module.exports = { positiveInteger, validateBooking, validateBookingFilters, checkInEligibility };
