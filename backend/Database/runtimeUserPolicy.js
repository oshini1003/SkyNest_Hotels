// Runtime SQL inventory, including the read-only audit verifier. Installation
// tools use separate maintenance credentials; this policy grants no DDL rights.
const TARGET_DATABASE = 'SkyNest_Integration_20261002';
const APP_USER = 'skynest_app';
const APP_HOST = 'localhost';

const TABLES = Object.freeze({
  BRANCH: { insert: ['Name', 'Location', 'ContactNumber'] },
  ROOM_TYPE: { insert: ['Name', 'Capacity', 'DailyRate'] },
  AMENITY: { insert: ['AmenityName'] },
  ROOM_TYPE_AMENITY: { insert: ['RoomTypeID', 'AmenityID'] },
  ROOM: { insert: ['BranchID', 'RoomTypeID', 'RoomNumber'], update: ['RoomStatus'] },
  GUEST: { insert: ['Name', 'ContactNumber', 'Email', 'IDNumber', 'Address'], update: ['Name', 'ContactNumber', 'Email', 'Address'] },
  GUEST_ACCOUNT: { insert: ['GuestID', 'Username', 'PasswordHash'], update: ['PasswordHash'] },
  STAFF: { insert: ['BranchID', 'Name', 'Role', 'Email'] },
  STAFF_ACCOUNT: { insert: ['StaffID', 'Username', 'PasswordHash'], update: ['PasswordHash'] },
  SERVICE_CATALOGUE: { insert: ['ServiceName', 'Description', 'UnitPrice'], update: ['ServiceName', 'Description', 'UnitPrice', 'IsActive'] },
  BOOKING: { insert: ['GuestID', 'StaffID', 'PreferredPaymentMethod'], update: ['BookingStatus'] },
  BOOKED_ROOMS: { insert: ['BookingID', 'RoomID', 'CheckInDateTime', 'CheckOutDateTime', 'GuestCount'] },
  SERVICE_USAGE: {},
  BILL: {},
  PAYMENT: {},
  REFRESH_TOKEN: { insert: ['UserType', 'UserID', 'Token', 'ExpiresAt'], update: ['RevokedAt'] },
  AUDIT_LOG: {},
});

const ROUTINES = Object.freeze({
  PROCEDURE: ['sp_make_booking', 'sp_check_in', 'sp_check_out', 'sp_log_service_usage', 'sp_process_payment', 'sp_update_booked_room'],
  FUNCTION: ['fn_calculate_room_charges', 'fn_calculate_service_charges', 'fn_calculate_outstanding_balance'],
});

function checkedDatabase(database) {
  // The caller must first enforce @@lower_case_table_names rules against the
  // configured target. Preserve the selected database's exact name in grants.
  if (typeof database !== 'string' || database.toLowerCase() !== TARGET_DATABASE.toLowerCase()) {
    throw new Error('The runtime grant policy permits only the integration database.');
  }
  return database;
}

const quote = value => '`' + value + '`';
const recipient = quote(APP_USER) + '@' + quote(APP_HOST);

function grantStatements(database) {
  const schema = quote(checkedDatabase(database));
  const grants = Object.entries(TABLES).map(([table, rights]) => {
    const clauses = ['SELECT'];
    for (const privilege of ['insert', 'update']) {
      if (rights[privilege]) clauses.push(`${privilege.toUpperCase()} (${rights[privilege].map(quote).join(', ')})`);
    }
    return `GRANT ${clauses.join(', ')} ON ${schema}.${quote(table)} TO ${recipient}`;
  });
  for (const [kind, names] of Object.entries(ROUTINES)) {
    for (const name of names) grants.push(`GRANT EXECUTE ON ${kind} ${schema}.${quote(name)} TO ${recipient}`);
  }
  return grants;
}

function invalid() { throw new Error('Runtime grants contain an unexpected or unsupported privilege, object, or account.'); }

// Tokenize the small SHOW GRANTS grammar we accept. No regex stripping of SQL
// suffixes: roles, proxies, wildcards, GRANT OPTION and unexpected syntax fail.
function tokens(sql) {
  if (typeof sql !== 'string' || !sql.trim()) invalid();
  const result = [];
  let offset = 0;
  while (offset < sql.length) {
    const char = sql[offset];
    if (/\s/.test(char)) { offset++; continue; }
    if (char === '`' || char === "'") {
      const delimiter = char;
      offset++;
      let value = '';
      let closed = false;
      while (offset < sql.length) {
        const next = sql[offset++];
        if (next === delimiter) {
          if (sql[offset] === delimiter) { value += delimiter; offset++; }
          else { closed = true; break; }
        } else value += next;
      }
      if (!closed) invalid();
      result.push({ kind: delimiter === '`' ? 'identifier' : 'string', value });
    } else if ('(),.@*;'.includes(char)) {
      result.push({ kind: 'punctuation', value: char });
      offset++;
    } else {
      const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(offset));
      if (!match) invalid();
      result.push({ kind: 'word', value: match[0] });
      offset += match[0].length;
    }
  }
  return result;
}

function parseGrant(sql, database) {
  const input = tokens(sql);
  let cursor = 0;
  const peek = value => input[cursor]?.value === value;
  const punctuation = value => {
    const token = input[cursor++];
    if (token?.kind !== 'punctuation' || token.value !== value) invalid();
  };
  const keyword = value => {
    const token = input[cursor++];
    if (token?.kind !== 'word' || token.value.toUpperCase() !== value) invalid();
  };
  const identifier = () => {
    const token = input[cursor++];
    if (!token || !['word', 'identifier'].includes(token.kind) || !/^[A-Za-z_][A-Za-z0-9_$]*$/.test(token.value)) invalid();
    return token.value;
  };
  const accountPart = () => {
    const token = input[cursor++];
    if (!token || !['word', 'identifier', 'string'].includes(token.kind)) invalid();
    return token.value;
  };

  keyword('GRANT');
  const privileges = [];
  do {
    if (privileges.length) punctuation(',');
    const token = input[cursor++];
    if (token?.kind !== 'word') invalid();
    const name = token.value.toUpperCase();
    if (!['USAGE', 'SELECT', 'INSERT', 'UPDATE', 'EXECUTE'].includes(name)) invalid();
    const columns = [];
    if (peek('(')) {
      punctuation('(');
      columns.push(identifier().toLowerCase());
      while (peek(',')) { punctuation(','); columns.push(identifier().toLowerCase()); }
      punctuation(')');
      if (!['INSERT', 'UPDATE'].includes(name) || new Set(columns).size !== columns.length) invalid();
    }
    privileges.push({ name, columns });
  } while (peek(','));

  keyword('ON');
  let kind = 'TABLE';
  if (input[cursor]?.kind === 'word' && ['PROCEDURE', 'FUNCTION'].includes(input[cursor].value.toUpperCase())) {
    kind = input[cursor++].value.toUpperCase();
  }
  let object;
  if (peek('*')) {
    punctuation('*'); punctuation('.'); punctuation('*');
    if (kind !== 'TABLE' || privileges.length !== 1 || privileges[0].name !== 'USAGE' || privileges[0].columns.length) invalid();
  } else {
    if (identifier() !== database) invalid();
    punctuation('.');
    object = identifier().toLowerCase();
  }
  keyword('TO');
  if (accountPart() !== APP_USER) invalid();
  punctuation('@');
  if (accountPart() !== APP_HOST) invalid();
  if (peek(';')) punctuation(';');
  if (cursor !== input.length) invalid();

  if (!object) return [];
  const result = [];
  for (const { name, columns } of privileges) {
    if (kind === 'TABLE') {
      if (name === 'SELECT' && columns.length === 0) result.push(`TABLE:${object}:SELECT`);
      else if (['INSERT', 'UPDATE'].includes(name) && columns.length) {
        for (const column of columns) result.push(`TABLE:${object}:${name}:${column}`);
      } else invalid();
    } else {
      if (name !== 'EXECUTE' || columns.length) invalid();
      result.push(`${kind}:${object}:EXECUTE`);
    }
  }
  return result;
}

function verifyGrants(rows, database) {
  checkedDatabase(database);
  if (!Array.isArray(rows) || !rows.length) invalid();
  const expected = new Set(grantStatements(database).flatMap(sql => parseGrant(sql, database)));
  const seen = new Set();
  for (const row of rows) {
    let sql = row;
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      const values = Object.values(row);
      if (values.length !== 1) invalid();
      [sql] = values;
    }
    for (const right of parseGrant(sql, database)) {
      if (!expected.has(right)) invalid();
      seen.add(right);
    }
  }
  if (expected.size !== seen.size) throw new Error('Required runtime privileges are missing.');
  return true;
}

module.exports = { TARGET_DATABASE, APP_USER, APP_HOST, grantStatements, verifyGrants };
