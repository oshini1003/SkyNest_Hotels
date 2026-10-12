'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const directory = path.join(__dirname, '../Database');
const {
  integrationDatabaseName,
  projectScripts,
} = require('../Database/setupIntegrationDb');

const read = file =>
  fs.readFileSync(path.join(directory, file), 'utf8');

const scripts = projectScripts();
const statements = scripts.flatMap(script => script.statements);

assert.deepEqual(
  scripts.map(script => script.file),
  ['tables.sql', 'functions.sql', 'schema.sql', 'seed.sql']
);

const expected = {
  TABLE: 'BRANCH ROOM_TYPE AMENITY ROOM_TYPE_AMENITY ROOM GUEST GUEST_ACCOUNT STAFF STAFF_ACCOUNT SERVICE_CATALOGUE BOOKING BOOKED_ROOMS SERVICE_USAGE BILL PAYMENT AUDIT_LOG REFRESH_TOKEN',
  INDEX: 'idx_bookedrooms_room_dates idx_bookedrooms_booking idx_booking_status idx_room_branch_type_status idx_serviceusage_booking idx_serviceusage_service_date idx_payment_booking idx_payment_bill idx_payment_date',
  FUNCTION: 'fn_calculate_room_charges fn_calculate_service_charges fn_calculate_bill_total fn_calculate_outstanding_balance',
  PROCEDURE: 'sp_make_booking sp_check_in sp_recalculate_bill sp_check_out sp_log_service_usage sp_process_payment sp_update_booked_room',
  TRIGGER: 'trg_audit_log_no_update trg_audit_log_no_delete trg_prevent_overlap_booking trg_room_status_sync trg_prevent_checkout_with_due trg_update_bill_status_after_payment trg_prevent_overlap_booking_update trg_validate_check_in_dates',
};

for (const [type, names] of Object.entries(expected)) {
  const actual = statements
    .map(sql => new RegExp(`^CREATE ${type} (\\w+)`).exec(sql)?.[1])
    .filter(Boolean);

  assert.deepEqual(
    actual.sort(),
    names.split(' ').sort(),
    `${type} inventory must appear exactly once.`
  );
}

const balance = statements.find(sql =>
  sql.startsWith('CREATE FUNCTION fn_calculate_outstanding_balance')
);

assert.match(
  balance,
  /SELECT MAX\(TotalAmount\) INTO v_total FROM BILL WHERE BookingID = p_booking_id;/
);

assert.match(
  balance,
  /COALESCE\(v_total, fn_calculate_bill_total\(p_booking_id\)\)/
);

assert.ok(
  !statements.some(sql => /^(?:CREATE DATABASE|USE |DROP )/.test(sql))
);

assert.throws(
  () => integrationDatabaseName('SkyNest_Hotels'),
  /DB_NAME/
);

const changed = (file, transform) => name =>
  name === file ? transform(read(name)) : read(name);

assert.throws(
  () => projectScripts(changed(
    'tables_indexes.sql',
    text => text.replace('Amount > 0', 'Amount >= 0')
  )),
  /different definition/
);

assert.throws(
  () => projectScripts(changed(
    'procedures.sql',
    text => text.replace("'Full'", "'Full '")
  )),
  /different definition/
);

assert.throws(
  () => projectScripts(changed(
    'functions.sql',
    text => text + '\n' + text
  )),
  /duplicate definition/
);

assert.throws(
  () => projectScripts(changed('tables.sql', () => '')),
  /Expected 17 TABLE/
);

assert.throws(
  () => projectScripts(changed(
    'seed.sql',
    text => text + '\nUSE another_database;'
  )),
  /database-selection/
);

async function run(options = {}) {
  const events = [];
  const messages = [];

  const fakeProcess = {
    env: {
      DB_NAME: 'SkyNest_Integration_SetupTest',
      DB_USER: 'maintenance',
    },
    exitCode: 0,
  };

  const connection = {
    async execute(sql, params) {
      events.push({ sql, params });

      if (sql.includes('SCHEMATA')) {
        return [
          options.exists
            ? [{ SCHEMA_NAME: fakeProcess.env.DB_NAME }]
            : [],
        ];
      }

      return [[{
        tables_count: options.badCounts ? 16 : 17,
        functions_count: 4,
        procedures_count: 7,
        triggers_count: 8,
      }]];
    },

    async query(sql) {
      events.push({ sql });

      if (options.race && sql.startsWith('CREATE DATABASE')) {
        throw Object.assign(new Error('Race'), {
          code: 'ER_DB_CREATE_EXISTS',
        });
      }

      if (options.failImport && sql.startsWith('CREATE TABLE')) {
        throw Object.assign(new Error('Import'), {
          code: 'ER_PARSE_ERROR',
        });
      }

      return [[{
        branches: 3,
        rooms: 7,
        guest_accounts: 3,
      }]];
    },

    async end() {
      events.push({ end: true });
    },
  };

  const moduleObject = { exports: {} };

  vm.runInNewContext(read('setupIntegrationDb.js'), {
    __dirname: directory,
    module: moduleObject,
    process: fakeProcess,

    console: {
      log: message => messages.push(message),
      error: message => messages.push(message),
    },

    require(name) {
      if (name === 'node:path') return path;

      if (name === 'node:fs') {
        return {
          readFileSync: file => {
            if (
              options.drift &&
              path.basename(file) === 'procedures.sql'
            ) {
              return read('procedures.sql')
                .replace("'Full'", "'Changed'");
            }

            return fs.readFileSync(file, 'utf8');
          },
        };
      }

      if (name === 'dotenv') {
        return { config() {} };
      }

      if (name === 'mysql2/promise') {
        return {
          createConnection: async config => {
            assert.equal(config.multipleStatements, false);
            assert.equal(config.database, undefined);
            events.push({ connect: true });
            return connection;
          },
        };
      }

      throw new Error(`Unexpected dependency: ${name}`);
    },
  });

  try {
    await moduleObject.exports.main();
  } catch (error) {
    messages.push(error.message);
    fakeProcess.exitCode = 1;
  }

  return {
    events,
    messages,
    code: fakeProcess.exitCode,
  };
}

(async () => {
  const drift = await run({ drift: true });
  assert.equal(drift.code, 1);
  assert.equal(
    drift.events.length,
    0,
    'SQL drift must stop before connecting.'
  );

  const existing = await run({ exists: true });
  assert.equal(existing.code, 1);
  assert.ok(!existing.events.some(event =>
    /^(CREATE|USE|SET|INSERT)/.test(event.sql || '')
  ));

  const race = await run({ race: true });
  assert.equal(race.code, 1);
  assert.ok(!race.events.some(event =>
    /^(USE|SET|INSERT|CREATE TABLE)/.test(event.sql || '')
  ));

  const success = await run();
  assert.equal(success.code, 0);

  const queries = success.events
    .filter(event => event.sql)
    .map(event => event.sql);

  assert.deepEqual(
    queries.slice(3, 3 + statements.length),
    statements,
    'Execute every canonical statement in dependency order, then seed.'
  );

  const incomplete = await run({ failImport: true });
  const wrongCounts = await run({ badCounts: true });
  assert.equal(wrongCounts.code, 1);

  for (const result of [
    existing,
    race,
    success,
    incomplete,
    wrongCounts,
  ]) {
    assert.deepEqual(result.events.at(-1), { end: true });
    assert.ok(!result.events.some(event =>
      /^DROP DATABASE/.test(event.sql || '')
    ));
  }

  assert.equal(incomplete.code, 1);
  assert.ok(incomplete.messages.some(message =>
    message.includes('left intact for inspection')
  ));

  console.log(
    'PASS: split SQL inventory/order, duplicate-fragment drift, saved-bill balance, existing/raced database refusal and failed-import cleanup (static SQL and mock connection; no live MySQL).'
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});