const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { configuration, cents, verifyScenario, readScenario } = require('../test-audit-log');

// Independent scenario fixtures validate the verifier without touching any database.
// SQL checks below examine transaction/guard contracts, not live MySQL execution.
const bookingId = 29, guestId = 17, billId = 13;
const config = stage => ({ stage, bookingId: String(bookingId) });
const copy = value => structuredClone(value);
const baseBill = { BillID: billId, BookingID: bookingId, RoomCharges: '12000.00',
  ServiceCharges: '0.00', TotalAmount: '12000.00', BillStatus: 'Unpaid', StaffID: null };
const header = status => ({ BookingID: bookingId, BookingStatus: status });
function fixtures() {
  const snapshot = { booking: { ...header('Checked-In'), GuestID: guestId }, bill: copy(baseBill), services: [], payments: [], audit: [] };
  let nextAudit = 9007199254740993n, nextOperation = 1;
  function pair(action, table, record, oldValue, value, billAction, before, after, actor = { ActorType: 'staff', StaffID: 3, GuestID: null }) {
    const common = { OperationID: `20000000-0000-4000-8000-${String(nextOperation++).padStart(12, '0')}`,
      ...actor, BookingID: bookingId, CreatedAt: '2026-10-07 10:15:40.012345' };
    snapshot.audit.push({ ...common, AuditID: String(nextAudit++), Action: action, TableAffected: table,
      RecordID: record, OldValues: copy(oldValue), NewValues: copy(value) });
    snapshot.audit.push({ ...common, AuditID: String(nextAudit++), Action: billAction, TableAffected: 'BILL',
      RecordID: billId, OldValues: copy(before), NewValues: copy(after) });
    snapshot.bill = copy(after);
  }
  pair('Check-In', 'BOOKING', bookingId, header('Booked'), header('Checked-In'), 'BillOpened', null, baseBill);
  const checkin = copy(snapshot);
  for (const [row, actor] of [
    [{ UsageID: 31, BookingID: bookingId, ServiceID: 4, Quantity: 2, PriceAtUsage: '800.00' }, { ActorType: 'staff', StaffID: 4, GuestID: null }],
    [{ UsageID: 32, BookingID: bookingId, ServiceID: 1, Quantity: 1, PriceAtUsage: '1500.00' }, { ActorType: 'guest', StaffID: null, GuestID: guestId }],
  ]) {
    const before = copy(snapshot.bill);
    const after = { ...before, ServiceCharges: row.UsageID === 31 ? '1600.00' : '3100.00', TotalAmount: row.UsageID === 31 ? '13600.00' : '15100.00' };
    snapshot.services.push(row);
    pair('ServiceUsageRecorded', 'SERVICE_USAGE', row.UsageID, null, row, 'BillRecalculated', before, after, actor);
  }
  const service = copy(snapshot);
  for (const row of [
    { PaymentID: 43, BookingID: bookingId, BillID: billId, Amount: '5000.00', PaymentType: 'Partial', PaymentMethod: 'Cash' },
    { PaymentID: 44, BookingID: bookingId, BillID: billId, Amount: '10100.00', PaymentType: 'Full', PaymentMethod: 'Bank Transfer' },
  ]) {
    const before = copy(snapshot.bill), after = { ...before, BillStatus: row.PaymentID === 43 ? 'Partially Paid' : 'Paid' };
    snapshot.payments.push(row);
    pair('PaymentProcessed', 'PAYMENT', row.PaymentID, null, row, 'BillPaymentApplied', before, after);
  }
  const payment = copy(snapshot);
  const before = copy(snapshot.bill), after = { ...before, StaffID: 3 };
  pair('Check-Out', 'BOOKING', bookingId, header('Checked-In'), header('Checked-Out'), 'BillFinalized', before, after);
  snapshot.booking.BookingStatus = 'Checked-Out';
  return { checkin, service, payment, checkout: snapshot };
}

// Independently specified bill transitions cover a service added after an earlier
// partial payment, and a new charge reopening a previously fully paid bill.
function guestServiceAfterPaymentFixture(fullyPaid = false) {
  const staffService = { UsageID: 51, BookingID: bookingId, ServiceID: 1,
    Quantity: 1, PriceAtUsage: '1500.00' };
  const guestService = { UsageID: 52, BookingID: bookingId, ServiceID: 4,
    Quantity: 2, PriceAtUsage: '800.00' };
  const payment = { PaymentID: 61, BookingID: bookingId, BillID: billId,
    Amount: fullyPaid ? '13500.00' : '6750.00',
    PaymentType: fullyPaid ? 'Full' : 'Partial', PaymentMethod: 'Cash' };
  const withService = { ...baseBill, ServiceCharges: '1500.00', TotalAmount: '13500.00' };
  const withPayment = { ...withService, BillStatus: fullyPaid ? 'Paid' : 'Partially Paid' };
  const finalBill = { ...baseBill, ServiceCharges: '3100.00', TotalAmount: '15100.00',
    BillStatus: 'Partially Paid' };
  const snapshot = { booking: { ...header('Checked-In'), GuestID: guestId },
    bill: copy(finalBill), services: [staffService, guestService], payments: [payment], audit: [] };
  const operations = [
    ['Check-In', 'BOOKING', bookingId, header('Booked'), header('Checked-In'), 'BillOpened', null, baseBill, 'staff', 3],
    ['ServiceUsageRecorded', 'SERVICE_USAGE', 51, null, staffService, 'BillRecalculated', baseBill, withService, 'staff', 4],
    ['PaymentProcessed', 'PAYMENT', 61, null, payment, 'BillPaymentApplied', withService, withPayment, 'staff', 3],
    ['ServiceUsageRecorded', 'SERVICE_USAGE', 52, null, guestService, 'BillRecalculated', withPayment, finalBill, 'guest', guestId],
  ];
  for (const [index, operation] of operations.entries()) {
    const [action, table, recordId, oldValue, value, billAction, before, after, actorType, actorId] = operation;
    const common = { OperationID: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      ActorType: actorType, StaffID: actorType === 'staff' ? actorId : null,
      GuestID: actorType === 'guest' ? actorId : null, BookingID: bookingId,
      CreatedAt: `2026-10-07 10:${String(20 + index).padStart(2, '0')}:00.000000` };
    snapshot.audit.push({ ...common, AuditID: String(101 + index * 2), Action: action,
      TableAffected: table, RecordID: recordId, OldValues: copy(oldValue), NewValues: copy(value) });
    snapshot.audit.push({ ...common, AuditID: String(102 + index * 2), Action: billAction,
      TableAffected: 'BILL', RecordID: billId, OldValues: copy(before), NewValues: copy(after) });
  }
  return snapshot;
}

function testGuestServicesAfterPayments() {
  const guestConfig = config('guest-service');
  for (const fullyPaid of [false, true]) {
    const snapshot = guestServiceAfterPaymentFixture(fullyPaid);
    assert.deepEqual(verifyScenario(guestConfig, snapshot), {
      events: 8, operations: 4, services: 2, payments: 1,
      paidCents: fullyPaid ? '1350000' : '675000',
    });
    assert.equal(snapshot.bill.BillStatus, 'Partially Paid');
    verifyScenario({ ...guestConfig, actorType: 'guest', actorId: String(guestId) }, snapshot);
    assert.throws(() => verifyScenario({ ...guestConfig, actorType: 'guest', actorId: '99' }, snapshot), /different account/);
    assert.throws(() => verifyScenario({ ...guestConfig, actorType: 'staff', actorId: '3' }, snapshot), /different actor type/);
    assert.throws(() => verifyScenario(config('service'), snapshot), /Select payment or checkout/,
      'The existing service stage must continue rejecting histories with payments.');
  }
  verifyScenario(guestConfig, fixtures().service); // Earlier payment is allowed, not required.
  assert.throws(() => verifyScenario(guestConfig, fixtures().checkin), /Record a service/);
  assert.throws(() => verifyScenario(guestConfig, fixtures().payment), /latest operation/);
  assert.throws(() => verifyScenario(guestConfig, fixtures().checkout), /Checked-In stay/);
  const failures = [
    ['Staff last service', data => {
      for (const row of data.audit.slice(-2)) { row.ActorType = 'staff'; row.StaffID = 4; row.GuestID = null; }
    }, /recorded by the owning guest/],
    ['Foreign last guest', data => { for (const row of data.audit.slice(-2)) row.GuestID = 99; }, /own the booking/],
    ['Missing last pair', data => { data.audit.pop(); }, /exactly/],
    ['Missing prior payment pair', data => { data.audit.splice(4, 2); }, /gap/],
    ['Changed service price', data => { data.services.at(-1).PriceAtUsage = '801.00'; }, /original saved price/],
    ['Changed earlier payment', data => { data.payments[0].Amount = '6750.01'; }, /Amount differs/],
    ['Broken before snapshot', data => { data.audit.at(-1).OldValues.BillStatus = 'Unpaid'; }, /gap/],
    ['Wrong final paid status after added service', data => {
      data.bill.BillStatus = 'Paid'; data.audit.at(-1).NewValues.BillStatus = 'Paid';
    }, /status does not reconcile/],
  ];
  for (const [name, change, error] of failures) {
    const data = guestServiceAfterPaymentFixture(); change(data);
    assert.throws(() => verifyScenario(guestConfig, data), error, name);
  }
  assert.deepEqual(configuration(['guest-service'], { TEST_AUDIT_BOOKING_ID: '29' }), {
    stage: 'guest-service', bookingId: '29', actorType: undefined, actorId: undefined,
  });
  assert.deepEqual(configuration(['guest-service'], { TEST_AUDIT_BOOKING_ID: '29',
    TEST_AUDIT_EXPECTED_ACTOR_TYPE: 'guest', TEST_AUDIT_EXPECTED_ACTOR_ID: '17' }), {
    stage: 'guest-service', bookingId: '29', actorType: 'guest', actorId: '17',
  });
}

function testHistories() {
  const histories = fixtures();
  for (const stage of Object.keys(histories)) verifyScenario(config(stage), histories[stage]);
  assert.equal(verifyScenario(config('checkout'), histories.checkout).paidCents, '1510000');
  verifyScenario({ ...config('service'), actorType: 'guest', actorId: String(guestId) }, histories.service);
  verifyScenario({ ...config('checkout'), actorType: 'staff', actorId: '3' }, histories.checkout);
  assert.throws(() => verifyScenario({ ...config('checkout'), actorType: 'staff', actorId: '99' }, histories.checkout), /different account/);
  const jsonStrings = copy(histories.checkout);
  for (const event of jsonStrings.audit) {
    if (event.OldValues !== null) event.OldValues = JSON.stringify(event.OldValues);
    event.NewValues = JSON.stringify(event.NewValues);
  }
  verifyScenario(config('checkout'), jsonStrings);
  const failures = [
    ['Missing event', data => { data.audit.splice(1, 1); }, /exactly/],
    ['Missing old history', data => { data.audit.splice(0, 2); }, /gap|Check-in/],
    ['Wrong pair', data => { data.audit[1].Action = 'BillFinalized'; }, /paired/],
    ['Different actor in pair', data => { data.audit[1].StaffID = 4; }, /same authenticated actor/],
    ['Mixed identity', data => { data.audit[0].GuestID = guestId; }, /guest actor/],
    ['Foreign guest actor', data => { data.audit[4].GuestID = 999; }, /own the booking/],
    ['Guest payment', data => { for (const row of data.audit.slice(6, 8)) { row.ActorType = 'guest'; row.StaffID = null; row.GuestID = guestId; } }, /Only staff/],
    ['Unknown payment', data => { data.payments.pop(); }, /missing from saved history/],
    ['Extra payment without audit', data => { data.payments.push({ ...data.payments[0], PaymentID: 99 }); }, /Every saved payment/],
    ['Missing service', data => { data.services.pop(); }, /missing from saved history/],
    ['Extra service without audit', data => { data.services.push({ ...data.services[0], UsageID: 99 }); }, /Every saved service/],
    ['Changed historical service price', data => { data.services[0].PriceAtUsage = '800.01'; }, /original saved price/],
    ['Changed historical payment', data => { data.payments[0].Amount = '5000.01'; }, /Amount differs/],
    ['Floating money snapshot', data => { data.audit[1].NewValues.RoomCharges = 12000; }, /decimal string/],
    ['Rounded final value', data => { data.bill.TotalAmount = '15100.01'; }, /saved room and service/],
    ['Lost bill continuity', data => { data.audit[3].OldValues.StaffID = 3; }, /gap/],
    ['Changed booking state', data => { data.booking.BookingStatus = 'Cancelled'; }, /status and audit/],
    ['Wrong checkout finalizer', data => { data.audit[11].NewValues.StaffID = 4; data.bill.StaffID = 4; }, /finalizer differs/],
    ['Unsafe AuditID number', data => { data.audit[0].AuditID = Number(data.audit[0].AuditID); }, /Invalid audit reference/],
    ['Duplicate audit reference', data => { data.audit[1].AuditID = data.audit[0].AuditID; }, /unique ascending/],
    ['Reused operation ID', data => { data.audit[2].OperationID = data.audit[0].OperationID; data.audit[3].OperationID = data.audit[0].OperationID; }, /exactly/],
    ['Wrong old booking', data => { data.audit[0].OldValues.BookingID = 99; }, /another booking/],
    ['Wrong affected record', data => { data.audit[3].RecordID = 99; }, /different bill/],
  ];
  for (const [name, change, error] of failures) {
    const data = copy(histories.checkout); change(data);
    assert.throws(() => verifyScenario(config('checkout'), data), error, name);
  }
  assert.throws(() => verifyScenario(config('checkout'), histories.payment), /checkout action/);
  assert.throws(() => verifyScenario(config('payment'), histories.checkout), /checkout stage/);
  assert.equal(cents('9007199254740993.01', 'exact money'), 900719925474099301n);
  for (const value of [1, '1.001', '-1.00', '1e2', '1', '01.00', '', NaN]) assert.throws(() => cents(value, 'invalid'));
  for (const value of ['', '0', '-1', ' 29 ', '29 OR 1=1', '1.0', '01', '2147483648']) {
    assert.throws(() => configuration(['checkin'], { TEST_AUDIT_BOOKING_ID: value }));
  }
  assert.equal(configuration(['--help'], {}), null);
  assert.throws(() => configuration(['reset'], { TEST_AUDIT_BOOKING_ID: '29' }));
  assert.throws(() => configuration(['checkin'], { TEST_AUDIT_BOOKING_ID: '29', TEST_AUDIT_EXPECTED_ACTOR_ID: '3' }));
}

async function testReadOnlySnapshot() {
  const snapshot = fixtures().checkout;
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(sql);
      assert.ok(/^(SET TRANSACTION ISOLATION LEVEL REPEATABLE READ|START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY|SELECT DATABASE|ROLLBACK)/.test(sql));
      if (sql.startsWith('SELECT DATABASE')) return [[{ db: 'skynest_integration_20261002', nameCase: 1 }]];
      return [[]];
    },
    async execute(sql, params) {
      calls.push(sql); assert.match(sql, /^SELECT /); assert.deepEqual(params, ['29']);
      if (sql.includes('FROM BOOKING ')) return [[snapshot.booking]];
      if (sql.includes('FROM BILL ')) return [[snapshot.bill]];
      if (sql.includes('FROM SERVICE_USAGE ')) return [snapshot.services];
      if (sql.includes('FROM PAYMENT ')) return [snapshot.payments];
      assert.match(sql, /FROM AUDIT_LOG WHERE BookingID = \? ORDER BY AuditID$/);
      return [snapshot.audit];
    },
  };
  assert.deepEqual(await readScenario(connection, '29'), snapshot);
  assert.equal(calls[0], 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  assert.equal(calls[1], 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  assert.equal(calls.at(-1), 'ROLLBACK');
  assert.equal(calls.filter(sql => sql.startsWith('START TRANSACTION')).length, 1);
  calls.length = 0;
  const failure = new Error('fixture read failed');
  await assert.rejects(readScenario({ ...connection, execute: async () => { throw failure; } }, '29'), error => error === failure);
  assert.equal(calls.at(-1), 'ROLLBACK', 'Read failures close the read-only snapshot.');
  calls.length = 0;
  await assert.rejects(readScenario({ ...connection, query: async sql => {
    calls.push(sql);
    if (sql.startsWith('SELECT DATABASE')) return [[{ db: 'SkyNest_Hotels', nameCase: 1 }]];
    return [[]];
  } }, '29'), /Unexpected database/);
  assert.ok(!calls.some(sql => /FROM BOOKING/.test(sql)), 'Unexpected database is rejected before hotel data is read.');
  assert.equal(calls.at(-1), 'ROLLBACK');
}

function testSqlContracts() {
  const schema = fs.readFileSync(path.join(__dirname, '../Database/schema.sql'), 'utf8').replace(/--[^\n]*/g, '');
  assert.match(schema, /CREATE TABLE AUDIT_LOG\s*\([\s\S]*?ENGINE=InnoDB;/, 'Audit events must roll back with hotel data.');
  for (const kind of ['UPDATE', 'DELETE']) {
    assert.match(schema, new RegExp(`BEFORE ${kind} ON AUDIT_LOG[\\s\\S]*?SIGNAL SQLSTATE '45000'[\\s\\S]*?END \\/\\/`), 'Audit rows are append-only through ordinary DML.');
  }
  const specifications = [
    ['sp_check_in', 'Check-In', 'BillOpened', /UPDATE BOOKING SET BookingStatus = 'Checked-In'/],
    ['sp_check_out', 'Check-Out', 'BillFinalized', /UPDATE BOOKING SET BookingStatus = 'Checked-Out'/],
    ['sp_log_service_usage', 'ServiceUsageRecorded', 'BillRecalculated', /INSERT INTO SERVICE_USAGE/],
    ['sp_process_payment', 'PaymentProcessed', 'BillPaymentApplied', /INSERT INTO PAYMENT/],
  ];
  for (const [name, action, companion, mutation] of specifications) {
    const routine = schema.match(new RegExp(`CREATE PROCEDURE ${name}\\([\\s\\S]*?END \\/\\/`))?.[0];
    assert.ok(routine, `${name} is missing.`);
    assert.match(routine, /DECLARE EXIT HANDLER FOR SQLEXCEPTION\s+BEGIN\s+ROLLBACK;\s+RESIGNAL;\s+END;/,
      'An audit failure must follow the same rollback handler as hotel mutations.');
    assert.equal((routine.match(/START TRANSACTION;/g) || []).length, 1);
    assert.equal((routine.match(/COMMIT;/g) || []).length, 1);
    const start = routine.indexOf('START TRANSACTION;'), audit = routine.indexOf('INSERT INTO AUDIT_LOG'), commit = routine.indexOf('COMMIT;');
    assert.ok(start < routine.search(mutation) && routine.search(mutation) < audit && audit < commit,
      `${name}: audit must be inside the same transaction after the hotel mutation and before commit.`);
    assert.match(routine, /FROM BOOKING WHERE BookingID = p_booking_id FOR UPDATE/,
      'Audit pairs must share the existing per-booking serialization.');
    assert.match(routine, /v_status IS NULL OR v_status !=/);
    assert.equal((routine.match(/SET v_operation_id = UUID\(\);/g) || []).length, 1);
    assert.ok(routine.includes(`'${action}'`) && routine.includes(`'${companion}'`));
    assert.equal((routine.slice(audit).match(/\(v_operation_id,/g) || []).length, 2, 'One UUID must link both events.');
    assert.ok(!/@[a-z_]/i.test(routine), 'Pooled session variables must not carry audit identity between requests.');
    for (const amount of ['RoomCharges', 'ServiceCharges', 'TotalAmount']) {
      assert.match(routine, new RegExp(`'${amount}',\\s*CAST\\(${amount} AS CHAR\\)`), 'JSON money must retain exact decimal text.');
    }
  }
  // Retain existing monetary contracts: audit additions must not remove these protections.
  const payment = schema.match(/CREATE PROCEDURE sp_process_payment\([\s\S]*?END \/\//)[0];
  assert.match(payment, /p_amount IS NULL OR p_amount <= 0 OR p_amount > v_outstanding/);
  assert.match(payment, /FROM BILL WHERE BookingID = p_booking_id FOR UPDATE/);
  const recalc = schema.match(/CREATE PROCEDURE sp_recalculate_bill\([\s\S]*?END \/\//)[0];
  assert.match(recalc, /SELECT RoomCharges INTO v_room_charges\s+FROM BILL WHERE BookingID = p_booking_id FOR UPDATE/);
  assert.ok(!/fn_calculate_room_charges/.test(recalc), 'Later bill calculations must preserve recorded room charges.');
}

(async () => {
  testHistories();
  testGuestServicesAfterPayments();
  await testReadOnlySnapshot();
  testSqlContracts();
  console.log('PASS: independent audit histories including guest services after partial/full payments; missing/duplicate events, owning-guest/latest-action checks, exact saved prices/payments and bill continuity; one read-only snapshot and SQL transaction/append-only/locking contracts (mock reads and static SQL, no live MySQL).');
})().catch(error => { console.error(error); process.exitCode = 1; });
