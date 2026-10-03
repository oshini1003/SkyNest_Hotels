const MAX_SQL_INT = 2147483647;
const MAX_PAYMENT_CENTS = 9999999999n;
const paymentRoles = new Set(['Admin', 'Manager', 'Receptionist']);
const paymentMethods = new Set(['Cash', 'Card', 'Bank Transfer']);

function positiveBookingId(raw) {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && !/^[1-9]\d*$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= MAX_SQL_INT ? value : null;
}

function paymentAmount(raw) {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  // Validate precision before MySQL sees DECIMAL(10,2): the database would
  // otherwise round a third decimal place and silently change the payment.
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(raw));
  if (!match) return null;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 99999999.99) return null;
  const cents = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0'));
  if (cents < 1n || cents > MAX_PAYMENT_CENTS) return null;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

function canProcessPayment(user) {
  return !!user && user.type === 'staff' && paymentRoles.has(user.role)
    && Number.isInteger(user.id) && user.id > 0 && user.id <= MAX_SQL_INT;
}

function validatePayment(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || !['bookingId', 'amount', 'paymentMethod'].every(field => Object.hasOwn(body, field))) {
    return { error: 'Provide bookingId, amount and paymentMethod.' };
  }
  const bookingId = positiveBookingId(body.bookingId);
  if (bookingId === null) {
    return { error: `bookingId must be a positive whole number no greater than ${MAX_SQL_INT}.` };
  }
  const amount = paymentAmount(body.amount);
  if (amount === null) {
    return { error: 'amount must be between 0.01 and 99999999.99 with no more than two decimal places.' };
  }
  if (!paymentMethods.has(body.paymentMethod)) {
    return { error: 'Choose Cash, Card or Bank Transfer.' };
  }
  // Identity, payment type, bill ID and balance are server-owned. Only these
  // validated values may be passed to the stored procedure.
  return { value: { bookingId, amount, paymentMethod: body.paymentMethod } };
}

module.exports = { positiveBookingId, paymentAmount, canProcessPayment, validatePayment };
