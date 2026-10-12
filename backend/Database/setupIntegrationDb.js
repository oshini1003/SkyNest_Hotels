// Fresh local integration databases only. Existing databases are never altered.
const fs = require('node:fs');
const path = require('node:path');

function integrationDatabaseName(value) {
  if (!/^SkyNest_Integration_[A-Za-z0-9_]+$/.test(value || '') || value.length > 64) {
    throw new Error('DB_NAME must start with SkyNest_Integration_ and use only letters, digits and underscores (maximum 64 characters).');
  }
  return value;
}

// The project SQL files put each statement's terminator at the end of a line.
// Keep routine bodies together while interpreting the MySQL client's DELIMITER.
function projectStatements(source) {
  const statements = [];
  let delimiter = ';';
  let pending = '';
  for (const line of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;
    const directive = trimmed.match(/^DELIMITER\s+(\S+)$/i);
    if (directive) {
      if (pending.trim()) throw new Error('Unexpected DELIMITER inside an unfinished SQL statement.');
      delimiter = directive[1];
      continue;
    }
    pending += line + '\n';
    if (trimmed.endsWith(delimiter)) {
      const statement = pending.trim().slice(0, -delimiter.length).trim();
      pending = '';
      if (/^USE\s+SkyNest_Hotels$/i.test(statement) ||
          /^CREATE DATABASE\s+SkyNest_Hotels CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci$/i.test(statement)) continue;
      if (/\b(?:CREATE|DROP|ALTER)\s+(?:DATABASE|SCHEMA)\b|^USE\b/i.test(statement)) {
        throw new Error('Unexpected database-selection or database-DDL statement in project SQL.');
      }
      if (statement) statements.push(statement);
    }
  }
  if (pending.trim()) throw new Error('SQL file ends with an unfinished statement.');
  return statements;
}

function projectScripts(read = file => fs.readFileSync(path.join(__dirname, file), 'utf8')) {
  const scripts = ['tables.sql', 'functions.sql', 'schema.sql', 'seed.sql']
    .map(file => ({ file, statements: projectStatements(read(file)) }));
  const definitions = new Map();
  const keyOf = sql => {
    const object = /^CREATE\s+(TABLE|FUNCTION|PROCEDURE|TRIGGER)\s+([A-Za-z_][A-Za-z_0-9]*)\b/i.exec(sql);
    if (object) return `${object[1].toUpperCase()}:${object[2]}`;
    const index = /^CREATE\s+INDEX\s+([A-Za-z_][A-Za-z_0-9]*)\s+ON\s+([A-Za-z_][A-Za-z_0-9]*)\b/i.exec(sql);
    return index ? `INDEX:${index[2]}:${index[1]}` : null;
  };


  const normalize = sql => (sql.match(/'(?:''|\\.|[^'\\])*'|"(?:""|\\.|[^"\\])*"|`(?:``|[^`])*`|--(?=\s)[^\r\n]*|[A-Za-z_][A-Za-z_0-9]*|\d+|[^\s]/g) || [])
    .filter(token => !token.startsWith('--')).join(' ');

  for (const script of scripts.slice(0, -1)) {
    for (const sql of script.statements) {
      if (script.file === 'tables.sql' && /^SET FOREIGN_KEY_CHECKS = [01]$/i.test(sql)) continue;
      const key = keyOf(sql);
      const allowed = {
        'tables.sql': /^(TABLE|INDEX):/,
        'functions.sql': /^FUNCTION:/,
        'schema.sql': /^(PROCEDURE|TRIGGER):/,
      };
      if (!key || !allowed[script.file].test(key) || definitions.has(key)) {
        throw new Error(`Unexpected or duplicate definition in ${script.file}.`);
      }
      definitions.set(key, normalize(sql));
    }
  }

  for (const [type, expected] of Object.entries({
    TABLE: 17, INDEX: 9, FUNCTION: 4, PROCEDURE: 7, TRIGGER: 8,
  })) {
    if ([...definitions.keys()].filter(key => key.startsWith(type + ':')).length !== expected) {
      throw new Error(`Expected ${expected} ${type} definitions in the fresh setup files.`);
    }
  }

  for (const file of ['tables_indexes.sql', 'procedures.sql']) {
    const seen = new Set();
    for (const sql of projectStatements(read(file))) {
      if (file === 'tables_indexes.sql' && /^SET FOREIGN_KEY_CHECKS = [01]$/i.test(sql)) continue;
      const key = keyOf(sql);
      if (!key || seen.has(key) || definitions.get(key) !== normalize(sql)) {
        throw new Error(`${file} contains an unexpected, duplicate or different definition. Review the split SQL files before setup.`);
      }
      seen.add(key);
    }
  }
  return scripts;
}


async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const mysql = require('mysql2/promise');
  const database = integrationDatabaseName(process.env.DB_NAME);
  const scripts = projectScripts();
  if (process.env.DB_PASSWORD === 'replace-with-your-local-mysql-password') {
    throw new Error('Set your actual local MySQL password in backend/.env first.');
  }

  let connection;
  let created = false;
  let stage = 'connecting to MySQL';
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: false,
    });
    const [existing] = await connection.execute(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [database]
    );
    if (existing.length) {
      throw new Error(`Database ${database} already exists. Nothing was changed. Use the existing database or choose a new integration name.`);
    }
    stage = 'creating the new integration database';
    // No IF NOT EXISTS: even a concurrent creation must fail before imports run.
    await connection.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    await connection.query(`USE \`${database}\``);
    for (const script of scripts) {
      for (let index = 0; index < script.statements.length; index++) {
        stage = `${script.file}, statement ${index + 1}`;
        await connection.query(script.statements[index]);
      }
    }
    stage = 'verifying database objects';
    const [[counts]] = await connection.execute(
      `SELECT
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?) AS tables_count,
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION') AS functions_count,
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE') AS procedures_count,
        (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = ?) AS triggers_count`,
      [database, database, database, database]
    );
    if (Number(counts.tables_count) !== 17 || Number(counts.functions_count) !== 4 ||
        Number(counts.procedures_count) !== 7 || Number(counts.triggers_count) !== 8) {
      throw new Error('Database object counts did not match the expected schema.');
    }
    const [[data]] = await connection.query(
      'SELECT (SELECT COUNT(*) FROM BRANCH) AS branches, (SELECT COUNT(*) FROM ROOM) AS rooms, (SELECT COUNT(*) FROM GUEST_ACCOUNT) AS guest_accounts'
    );
    console.log(`Created ${database}: 17 tables, 4 functions, 7 procedures, 8 triggers.`);
    console.log(`Seeded ${data.branches} branches, ${data.rooms} rooms, ${data.guest_accounts} guest accounts.`);
    console.log('Database setup complete. Start the backend with npm run dev.');
  } catch (error) {
    if (error.code) {
      console.error(`Setup failed during ${stage} (${error.code}).`);
    } else {
      console.error(error.message);
    }
    if (created) {
      console.error(`The new database ${database} may be incomplete. It has been left intact for inspection; do not re-import or delete it automatically.`);
    }
    process.exitCode = 1;
  } finally {
    if (connection) await connection.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.code || error.message);
    process.exitCode = 1;
  });
}

module.exports = { integrationDatabaseName, projectStatements, projectScripts, main };