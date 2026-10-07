'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { checkRuntimeAccess } = require('./Database/runtimeUserAccess');

(async () => {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && args[0] !== '--candidate')) throw new Error('Usage: node backend/check-runtime-user.js [--candidate]');
  if (Object.keys(process.env).some(key => /^DB_(HOST|PORT|USER|PASSWORD|NAME)$/i.test(key))) throw new Error('Remove shell DB_* overrides before verifying the file configuration.');
  const values = dotenv.parse(fs.readFileSync(path.join(__dirname, args.length ? '.env.runtime' : '.env'), 'utf8'));
  const config = { host: values.DB_HOST, port: Number(values.DB_PORT || 3306), user: values.DB_USER,
    password: values.DB_PASSWORD, database: values.DB_NAME };
  if (config.user !== 'skynest_app' || !config.password) throw new Error('This file is not configured for skynest_app.');
  const connection = await require('mysql2/promise').createConnection(config);
  try {
    const result = await checkRuntimeAccess(connection, config);
    console.log(`PASS: ${result.currentUser} on ${result.database}; exact grants, 17 empty table reads, 5 empty locking reads, 7 permission denials.`);
    console.log('No hotel rows were changed. Business routine execution and browser workflows require their separate smoke checks.');
  } finally { await connection.end(); }
})().catch(error => {
  console.error(error.code ? `Runtime check failed (${/^[A-Z0-9_]+$/.test(error.code) ? error.code : 'DATABASE_ERROR'}).` : error.message);
  process.exitCode = 1;
});
