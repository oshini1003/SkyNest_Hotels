'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const { TARGET_DATABASE, APP_USER, APP_HOST, grantStatements, verifyGrants } = require('./runtimeUserPolicy');
const { identityOf, verifyTarget, verifyObjects, checkRuntimeAccess } = require('./runtimeUserAccess');
const ACCOUNT = "'skynest_app'@'localhost'";
const LOCK_NAME = 'skynest_runtime_account_setup';

function configuration(values) {
  if (values.DB_NAME !== TARGET_DATABASE || values.DB_USER !== 'root' || !values.DB_PASSWORD ||
      !['localhost', '127.0.0.1', '::1'].includes(values.DB_HOST) || !/^\d+$/.test(values.DB_PORT || '3306')) {
    throw new Error('Expected the existing local root configuration for SkyNest_Integration_20261002.');
  }
  const port = Number(values.DB_PORT || '3306');
  if (port < 1 || port > 65535) throw new Error('Invalid database port.');
  return { host: values.DB_HOST, port, user: values.DB_USER, password: values.DB_PASSWORD, database: values.DB_NAME };
}
function runtimeText(text, password) {
  if (!/^Aa1![a-f0-9]{64}$/.test(password)) throw new Error('Invalid generated credential format.');
  // Drop all existing assignments (including export syntax), then append one authoritative value.
  const clean = text.split(/\r?\n/).filter(line => !/^\s*(?:export\s+)?DB_(?:USER|PASSWORD)\s*=/.test(line)).join('\n');
  const result = `${clean.trimEnd()}\nDB_USER=${APP_USER}\nDB_PASSWORD="${password}"\n`;
  const parsed = dotenv.parse(result);
  const before = dotenv.parse(text);
  if (parsed.DB_USER !== APP_USER || parsed.DB_PASSWORD !== password) throw new Error('Cannot prepare runtime configuration.');
  for (const key of new Set([...Object.keys(before), ...Object.keys(parsed)])) {
    if (!['DB_USER', 'DB_PASSWORD'].includes(key) && before[key] !== parsed[key]) {
      throw new Error('Unusual environment formatting requires manual review; no credential files were written.');
    }
  }
  return result;
}

async function provision({ admin, config, connectRuntime, saveCredentials, backendStopped, password }) {
  if (backendStopped !== true) throw new Error('Stop the backend and pass --backend-stopped first.');
  if (config.user !== 'root' || !/^Aa1![a-f0-9]{64}$/.test(password)) throw new Error('Invalid setup configuration.');
  const identity = await identityOf(admin);
  const database = verifyTarget(config, identity);
  if (identity.currentUser !== 'root@localhost' || identity.activeRoles !== 'NONE') {
    throw new Error('Run this one-time setup as the existing root@localhost maintenance account without active roles.');
  }
  const [[lock]] = await admin.execute('SELECT GET_LOCK(?, 0) AS acquired', [LOCK_NAME]);
  if (Number(lock?.acquired) !== 1) throw new Error('Another runtime-account setup is active.');
  let createAttempted = false;
  let created = false;
  let runtime;
  let stage = 'preflight';
  let failed = false;
  try {
    const [existing] = await admin.execute('SELECT User, Host FROM mysql.user WHERE User = ?', [APP_USER]);
    if (existing.length) throw new Error('skynest_app already exists. Nothing was changed; inspect its grants before retrying.');
    await verifyObjects(admin, database, identity.currentUser);
    stage = 'saving private configuration files';
    await saveCredentials(); // Exclusive files, before CREATE USER. Never overwrite the running .env.
    stage = 'creating the locked account';
    createAttempted = true;
    // Password alphabet is strictly checked above; no quotes, backslashes or SQL-mode-dependent escaping.
    await admin.query(`CREATE USER ${ACCOUNT} IDENTIFIED BY '${password}' ACCOUNT LOCK`);
    created = true;
    stage = 'granting the reviewed privileges';
    for (const sql of grantStatements(database)) await admin.query(sql);
    stage = 'verifying grants';
    const [grants] = await admin.query(`SHOW GRANTS FOR ${ACCOUNT}`);
    verifyGrants(grants, database);
    stage = 'unlocking and checking the new connection';
    await admin.query(`ALTER USER ${ACCOUNT} ACCOUNT UNLOCK`);
    runtime = await connectRuntime({ ...config, user: APP_USER, password });
    const result = await checkRuntimeAccess(runtime, { ...config, user: APP_USER });
    return result;
  } catch (error) {
    failed = true;
    if (createAttempted && !created) {
      // A lost CREATE acknowledgement can only leave our account locked. Do not
      // alter an account another administrator may have created concurrently.
      const code = /^[A-Z0-9_]+$/.test(error.code || '') ? ` (${error.code})` : '';
      throw new Error(`Account creation could not be confirmed${code}. Keep the current .env and inspect skynest_app before retrying; no existing account was altered.`);
    }
    if (created) {
      // Fail closed even after a lost UNLOCK acknowledgement. Do not drop
      // accounts or hotel objects. Account locking does not kill existing sessions;
      // this setup has only its own temporary connection, closed below.
      try { await admin.query(`ALTER USER ${ACCOUNT} ACCOUNT LOCK`); }
      catch { throw new Error('Setup stopped; account lock state could not be confirmed. Keep the current .env and inspect skynest_app with your administrator.'); }
      const code = /^[A-Z0-9_]+$/.test(error.code || '') ? ` (${error.code})` : '';
      throw new Error(`Setup stopped during ${stage}${code}; skynest_app was locked. Keep the current .env and both private credential files for inspection.`);
    }
    throw error;
  } finally {
    let cleanupFailed = false;
    try { if (runtime) await runtime.end(); } catch { cleanupFailed = true; }
    try { await admin.execute('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch { cleanupFailed = true; }
    if (cleanupFailed && !failed) throw new Error('Connection cleanup could not be confirmed. Keep the current .env and inspect before activating.');
  }
}

async function main() {
  if (process.argv.slice(2).join(' ') !== '--backend-stopped') throw new Error('Usage: node backend/Database/setupRuntimeUser.js --backend-stopped');
  if (Object.keys(process.env).some(key => /^DB_(HOST|PORT|USER|PASSWORD|NAME)$/i.test(key))) {
    throw new Error('Remove shell DB_* overrides first; this setup reads backend/.env explicitly.');
  }
  const backend = path.resolve(__dirname, '..');
  const source = path.join(backend, '.env');
  const maintenance = path.join(backend, '.env.maintenance');
  const candidate = path.join(backend, '.env.runtime');
  if ([maintenance, candidate].some(file => fs.existsSync(file))) throw new Error('Private maintenance/runtime files already exist. Nothing was overwritten; inspect before retrying.');
  const original = fs.readFileSync(source, 'utf8');
  const config = configuration(dotenv.parse(original));
  const password = `Aa1!${crypto.randomBytes(32).toString('hex')}`;
  const candidateText = runtimeText(original, password);
  const mysql = require('mysql2/promise');
  const admin = await mysql.createConnection(config);
  try {
    const result = await provision({ admin, config, password, backendStopped: true,
      connectRuntime: options => mysql.createConnection(options),
      saveCredentials: async () => {
        fs.writeFileSync(maintenance, original, { flag: 'wx', mode: 0o600 });
        fs.writeFileSync(candidate, candidateText, { flag: 'wx', mode: 0o600 });
      },
    });
    console.log(`PASS: ${result.currentUser}; exact table/column/routine grants, empty locking reads and permission denials verified.`);
    console.log('Created backend/.env.maintenance (original configuration) and backend/.env.runtime (new candidate). Passwords were not printed.');
    console.log('backend/.env is unchanged. Activate the verified candidate only after this PASS. No hotel rows or stored definitions were changed.');
  } finally { await admin.end(); }
}
if (require.main === module) main().catch(error => {
  // Driver messages/SQL can contain generated credentials. Do not print them.
  const safe = error.code ? `Database setup failed (${/^[A-Z0-9_]+$/.test(error.code) ? error.code : 'DATABASE_ERROR'}). Keep the current .env.` : error.message;
  console.error(safe);
  process.exitCode = 1;
});
module.exports = { configuration, runtimeText, provision };
