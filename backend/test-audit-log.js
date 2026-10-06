// Read-only verification of a fresh stay after manual actions through the UI.
// This script never creates a reservation, records a charge/payment, or checks out a stay.
const assert = require('node:assert/strict');
const path = require('node:path');

const stages = ['checkin', 'service', 'payment', 'checkout'];
const actions = {
  'Check-In': { table: 'BOOKING', companion: 'BillOpened' },
  ServiceUsageRecorded: { table: 'SERVICE_USAGE', companion: 'BillRecalculated' },
  PaymentProcessed: { table: 'PAYMENT', companion: 'BillPaymentApplied' },
  'Check-Out': { table: 'BOOKING', companion: 'BillFinalized' },
};
const stageActions = ['Check-In', 'ServiceUsageRecorded', 'PaymentProcessed', 'Check-Out'];
const billFields = ['BillID', 'BookingID', 'RoomCharges', 'ServiceCharges', 'TotalAmount', 'BillStatus', 'StaffID'];
const moneyFields = ['RoomCharges', 'ServiceCharges', 'TotalAmount'];
const usage = `Usage: node backend/test-audit-log.js checkin|service|payment|checkout
Set TEST_AUDIT_BOOKING_ID to a NEW booking checked in after the audit migration.
Perform each hotel action manually through the application before verifying its stage.
Optional: TEST_AUDIT_EXPECTED_ACTOR_TYPE=staff|guest and TEST_AUDIT_EXPECTED_ACTOR_ID.
The optional identity checks the latest operation for the selected stage.
Database settings come from backend/.env, independent of the current directory.
Only SkyNest_Integration_20261002 is permitted. All database access is read-only.
No old audit history is fabricated and no hotel rows or login sessions are changed.`;

function positiveId(value, message, maximum = 2147483647n) {
  assert.ok((typeof value === 'string' || typeof value === 'number')
    && /^[1-9]\d*$/.test(String(value)), message);
  if (typeof value === 'number') assert.ok(Number.isSafeInteger(value), message);
  const result = BigInt(value);
  assert.ok(result <= maximum, message);
  return String(result);
}
function cents(value, message) {
  assert.equal(typeof value, 'string', `${message}: money must remain a decimal string.`);
  const match = /^(0|[1-9]\d*)\.(\d{2})$/.exec(value);
  assert.ok(match, `${message}: expected a non-negative amount with two decimal places.`);
  return BigInt(match[1]) * 100n + BigInt(match[2]);
}
function jsonObject(value, name, nullable = false) {
  if (value === null && nullable) return null;
  if (typeof value === 'string') value = JSON.parse(value);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${name} must be a JSON object.`);
  return value;
}
function sameId(actual, expected, message) {
  assert.equal(positiveId(actual, message), positiveId(expected, message), message);
}
function canonicalBill(source, bookingId, billId) {
  const value = jsonObject(source, 'Bill snapshot');
  for (const field of billFields) assert.ok(Object.hasOwn(value, field), `Bill snapshot lacks ${field}.`);
  sameId(value.BookingID, bookingId, 'Bill snapshot belongs to a different booking.');
  sameId(value.BillID, billId, 'Bill snapshot references a different bill.');
  const result = { ...Object.fromEntries(billFields.map(key => [key, value[key]])),
    BookingID: String(value.BookingID), BillID: String(value.BillID),
    StaffID: value.StaffID === null ? null : positiveId(value.StaffID, 'Invalid bill finalizer.') };
  for (const field of moneyFields) cents(result[field], field);
  assert.equal(cents(result.RoomCharges, 'Room charges') + cents(result.ServiceCharges, 'Service charges'),
    cents(result.TotalAmount, 'Total amount'), 'Bill total must equal its saved room and service charges.');
  assert.ok(['Unpaid', 'Partially Paid', 'Paid'].includes(result.BillStatus), 'Invalid bill status.');
  return result;
}
function configuration(argv = process.argv.slice(2), env = process.env) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return null;
  assert.ok(argv.length === 1 && stages.includes(argv[0]), usage);
  const bookingId = positiveId(env.TEST_AUDIT_BOOKING_ID, 'Set TEST_AUDIT_BOOKING_ID to a positive booking reference (digits only).');
  const actorType = env.TEST_AUDIT_EXPECTED_ACTOR_TYPE;
  const rawActor = env.TEST_AUDIT_EXPECTED_ACTOR_ID;
  assert.ok((actorType === undefined) === (rawActor === undefined), 'Set both optional expected-actor variables, or neither.');
  let actorId;
  if (actorType !== undefined) {
    assert.ok(['staff', 'guest'].includes(actorType), 'Expected actor type must be staff or guest.');
    actorId = positiveId(rawActor, 'Expected actor ID must be a positive integer.');
  }
  return { stage: argv[0], bookingId, actorType, actorId };
}

function verifyScenario(config, snapshot) {
  const { booking, bill, services, payments } = snapshot;
  assert.ok(booking, 'Booking not found.');
  sameId(booking.BookingID, config.bookingId, 'Unexpected booking reference.');
  assert.ok(bill, 'Check in this new reservation through the staff page first.');
  const currentBill = canonicalBill(bill, config.bookingId, bill.BillID);
  const auditRows = snapshot.audit.map(row => ({ ...row,
    OldValues: jsonObject(row.OldValues, 'OldValues', true), NewValues: jsonObject(row.NewValues, 'NewValues') }));
  assert.ok(auditRows.length, 'No audit events for this booking. Use a new stay checked in after the migration.');
  const grouped = new Map();
  let lastId = 0n;
  for (const event of auditRows) {
    const id = BigInt(positiveId(event.AuditID, 'Invalid audit reference.', 18446744073709551615n));
    assert.ok(id > lastId, 'Audit rows must be in unique ascending AuditID order.'); lastId = id;
    sameId(event.BookingID, config.bookingId, 'Audit event belongs to a different booking.');
    assert.match(event.OperationID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid operation reference.');
    assert.match(event.CreatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/, 'Invalid audit timestamp.');
    assert.ok(['staff', 'guest'].includes(event.ActorType), 'Invalid audit actor type.');
    if (event.ActorType === 'staff') {
      positiveId(event.StaffID, 'Staff audit needs an authenticated staff reference.');
      assert.equal(event.GuestID, null, 'Staff event must not contain a guest actor.');
    } else {
      assert.equal(event.StaffID, null, 'Guest event must not contain a staff actor.');
      sameId(event.GuestID, booking.GuestID, 'Guest service actor must own the booking.');
    }
    if (!grouped.has(event.OperationID)) grouped.set(event.OperationID, []);
    grouped.get(event.OperationID).push(event);
  }
  const operations = [...grouped.values()];
  const serviceMap = new Map(services.map(row => [String(row.UsageID), row]));
  const paymentMap = new Map(payments.map(row => [String(row.PaymentID), row]));
  assert.equal(serviceMap.size, services.length, 'Duplicate saved service references.');
  assert.equal(paymentMap.size, payments.length, 'Duplicate saved payment references.');
  const seenServices = new Set(), seenPayments = new Set();
  const counts = Object.fromEntries(stageActions.map(action => [action, 0]));
  let lastBill = null, paid = 0n, checkedOut = false;
  let selectedOperation;
  for (const [index, events] of operations.entries()) {
    assert.equal(events.length, 2, 'Each operation must contain exactly its action and bill audit events.');
    assert.equal(auditRows[index * 2], events[0], 'Operation events must remain together in booking history.');
    assert.equal(auditRows[index * 2 + 1], events[1], 'Operation events must remain together in booking history.');
    const primary = events.find(event => Object.hasOwn(actions, event.Action));
    assert.ok(primary, 'Unknown audit operation.');
    const billEvent = events.find(event => event !== primary);
    assert.equal(billEvent.Action, actions[primary.Action].companion, 'Missing or mismatched paired bill event.');
    assert.equal(primary.TableAffected, actions[primary.Action].table, 'Incorrect primary audit table.');
    assert.equal(billEvent.TableAffected, 'BILL', 'Paired event must describe the bill.');
    sameId(billEvent.RecordID, bill.BillID, 'Paired event references a different bill.');
    for (const field of ['ActorType', 'StaffID', 'GuestID']) {
      assert.equal(billEvent[field], primary[field], 'Both events must retain the same authenticated actor.');
    }
    assert.ok(!checkedOut, 'No further hotel operations may follow checkout.');
    if (primary.Action !== 'ServiceUsageRecorded') assert.equal(primary.ActorType, 'staff', 'Only staff may perform this action.');
    const before = billEvent.OldValues === null ? null : canonicalBill(billEvent.OldValues, config.bookingId, bill.BillID);
    const after = canonicalBill(billEvent.NewValues, config.bookingId, bill.BillID);
    assert.deepEqual(before, lastBill, 'Bill history has a gap or its before/after snapshots disagree.');
    if (lastBill) assert.equal(after.RoomCharges, lastBill.RoomCharges, 'Recorded room charges must remain fixed.');
    const value = primary.NewValues;
    sameId(value.BookingID, config.bookingId, 'Action snapshot belongs to another booking.');
    if (primary.Action === 'Check-In') {
      assert.equal(index, 0, 'Check-in must be the first and only opening operation.');
      sameId(primary.RecordID, config.bookingId, 'Incorrect check-in record.');
      sameId(primary.OldValues?.BookingID, config.bookingId, 'Old check-in snapshot belongs to another booking.');
      assert.equal(primary.OldValues?.BookingStatus, 'Booked');
      assert.equal(value.BookingStatus, 'Checked-In');
      assert.equal(before, null, 'Bill must have no earlier snapshot when opened.');
      assert.equal(cents(after.ServiceCharges, 'Opening services'), 0n, 'New stay must open without service entries.');
      assert.equal(after.BillStatus, 'Unpaid');
    } else {
      assert.ok(lastBill, 'Check-in and bill-opening audit events are required for this verification.');
      if (primary.Action === 'ServiceUsageRecorded') {
        assert.equal(primary.OldValues, null, 'New service usage must not have an old row snapshot.');
        const key = positiveId(primary.RecordID, 'Invalid service reference.');
        assert.ok(!seenServices.has(key), 'Service usage was audited more than once.'); seenServices.add(key);
        const saved = serviceMap.get(key);
        assert.ok(saved, 'Audited service is missing from saved history.');
        sameId(value.UsageID, key, 'Service snapshot reference differs.');
        for (const field of ['BookingID', 'ServiceID', 'Quantity']) sameId(value[field], saved[field], `Service ${field} differs from saved history.`);
        assert.equal(value.PriceAtUsage, saved.PriceAtUsage, 'Service snapshot must preserve the original saved price.');
        const charge = cents(value.PriceAtUsage, 'Saved service price') * BigInt(value.Quantity);
        assert.equal(cents(after.ServiceCharges, 'New services') - cents(before.ServiceCharges, 'Old services'), charge,
          'Service bill change must equal the saved quantity times price.');
      } else if (primary.Action === 'PaymentProcessed') {
        assert.equal(primary.OldValues, null, 'New payment must not have an old row snapshot.');
        const key = positiveId(primary.RecordID, 'Invalid payment reference.');
        assert.ok(!seenPayments.has(key), 'Payment was audited more than once.'); seenPayments.add(key);
        const saved = paymentMap.get(key);
        assert.ok(saved, 'Audited payment is missing from saved history.');
        sameId(value.PaymentID, key, 'Payment snapshot reference differs.');
        for (const field of ['BookingID', 'BillID']) sameId(value[field], saved[field], `Payment ${field} differs from saved history.`);
        for (const field of ['Amount', 'PaymentType', 'PaymentMethod']) assert.equal(value[field], saved[field], `Payment ${field} differs from saved history.`);
        const amount = cents(value.Amount, 'Payment amount');
        assert.ok(amount > 0n && paid + amount <= cents(before.TotalAmount, 'Bill total'), 'Payment exceeds the saved outstanding balance.');
        assert.equal(value.PaymentType, paid + amount === cents(before.TotalAmount, 'Bill total') ? 'Full' : 'Partial');
        paid += amount;
        for (const field of moneyFields) assert.equal(after[field], before[field], 'Recording a payment must not alter charges.');
      } else {
        sameId(primary.RecordID, config.bookingId, 'Incorrect checkout record.');
        sameId(primary.OldValues?.BookingID, config.bookingId, 'Old checkout snapshot belongs to another booking.');
        assert.equal(primary.OldValues?.BookingStatus, 'Checked-In');
        assert.equal(value.BookingStatus, 'Checked-Out');
        assert.equal(paid, cents(after.TotalAmount, 'Finalized bill'), 'Checkout requires a fully settled bill.');
        sameId(after.StaffID, primary.StaffID, 'Bill finalizer differs from the checkout actor.');
        checkedOut = true;
      }
      assert.equal(after.BillStatus, paid >= cents(after.TotalAmount, 'Total') ? 'Paid' : paid > 0n ? 'Partially Paid' : 'Unpaid',
        'Bill status does not reconcile with recorded charges and payments.');
    }
    if (!checkedOut) assert.equal(after.StaffID, null, 'Bill finalizer must remain empty until checkout.');
    counts[primary.Action] += 1;
    if (primary.Action === stageActions[stages.indexOf(config.stage)]) selectedOperation = primary;
    lastBill = after;
  }
  assert.equal(counts['Check-In'], 1, 'Exactly one audited check-in is required.');
  assert.deepEqual(lastBill, currentBill, 'Latest bill audit must match the saved bill.');
  assert.equal(seenServices.size, services.length, 'Every saved service must have exactly one audit operation.');
  assert.equal(seenPayments.size, payments.length, 'Every saved payment must have exactly one audit operation.');
  assert.equal(booking.BookingStatus, checkedOut ? 'Checked-Out' : 'Checked-In', 'Saved booking status and audit history differ.');
  const stageIndex = stages.indexOf(config.stage);
  for (let index = 0; index <= stageIndex; index += 1) assert.ok(counts[stageActions[index]] > 0, `Complete the ${stages[index]} action through the application first.`);
  if (stageIndex === 0) assert.equal(services.length + payments.length + counts['Check-Out'], 0, 'Select the later stage matching the actions already completed.');
  if (stageIndex === 1) assert.equal(payments.length + counts['Check-Out'], 0, 'Select payment or checkout to verify the later stage.');
  if (stageIndex === 2) assert.equal(counts['Check-Out'], 0, 'Use the checkout stage for a completed stay.');
  if (config.actorType) {
    assert.equal(selectedOperation.ActorType, config.actorType, 'Latest stage action was performed by a different actor type.');
    sameId(selectedOperation[config.actorType === 'staff' ? 'StaffID' : 'GuestID'], config.actorId, 'Latest stage action was performed by a different account.');
  }
  return { events: auditRows.length, operations: operations.length, services: services.length, payments: payments.length, paidCents: paid.toString() };
}

async function readScenario(connection, bookingId) {
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    const [[database]] = await connection.query('SELECT DATABASE() AS db, @@lower_case_table_names AS nameCase');
    const expected = 'SkyNest_Integration_20261002';
    assert.equal(Number(database.nameCase) === 0 ? database.db : database.db?.toLowerCase(),
      Number(database.nameCase) === 0 ? expected : expected.toLowerCase(), 'Unexpected database; no hotel rows were changed.');
    const [[booking]] = await connection.execute('SELECT BookingID, GuestID, BookingStatus FROM BOOKING WHERE BookingID = ?', [bookingId]);
    const [[bill]] = await connection.execute('SELECT BillID, BookingID, StaffID, RoomCharges, ServiceCharges, TotalAmount, BillStatus FROM BILL WHERE BookingID = ?', [bookingId]);
    const [services] = await connection.execute('SELECT UsageID, BookingID, ServiceID, Quantity, PriceAtUsage FROM SERVICE_USAGE WHERE BookingID = ? ORDER BY UsageID', [bookingId]);
    const [payments] = await connection.execute('SELECT PaymentID, BookingID, BillID, Amount, PaymentType, PaymentMethod FROM PAYMENT WHERE BookingID = ? ORDER BY PaymentID', [bookingId]);
    const [audit] = await connection.execute('SELECT AuditID, OperationID, ActorType, StaffID, GuestID, BookingID, Action, TableAffected, RecordID, OldValues, NewValues, CreatedAt FROM AUDIT_LOG WHERE BookingID = ? ORDER BY AuditID', [bookingId]);
    await connection.query('ROLLBACK');
    return { booking, bill, services, payments, audit };
  } catch (error) {
    try { await connection.query('ROLLBACK'); } catch { /* Keep the original failure. */ }
    throw error;
  }
}
async function main() {
  const config = configuration();
  if (!config) { console.log(usage); return; }
  require('dotenv').config({ path: path.join(__dirname, '.env') });
  assert.equal(process.env.DB_NAME, 'SkyNest_Integration_20261002', 'DB_NAME must be SkyNest_Integration_20261002.');
  const mysql = require('mysql2/promise');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost', port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME,
    supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false, dateStrings: true,
    connectTimeout: 10000, multipleStatements: false,
  });
  try {
    const result = verifyScenario(config, await readScenario(connection, config.bookingId));
    console.log(`PASS: ${config.stage}; booking #${config.bookingId}, ${result.operations} paired operations, ${result.events} audit events, ${result.services} service entries and ${result.payments} payments.`);
    console.log('Audit actors, before/after bill history, saved service prices and payment amounts reconcile.');
    console.log('READ ONLY: no hotel rows or login sessions were changed. This check does not test rollback behavior or historical events before audit installation.');
  } finally { await connection.end(); }
}
if (require.main === module) main().catch(error => {
  console.error(`FAIL: ${error.code && error.code !== 'ERR_ASSERTION' ? error.code : error.message}`);
  process.exitCode = 1;
});
module.exports = { configuration, cents, verifyScenario, readScenario };
