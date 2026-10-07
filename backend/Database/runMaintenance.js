'use strict';
// Run only reviewed installation entry points with the separately stored DB credentials.
// Never imported by server.js; no administrative fallback in the runtime pool.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const allowed = new Set(['setupIntegrationDb.js', 'addBookingUpdate.js', 'addAuditLog.js', 'updateBillingRoutine.js']);
function command(args, contents, environment = process.env) {
  const [script, ...rest] = args;
  if (!allowed.has(script) || rest.some(arg => arg !== '--backend-stopped') || rest.length > 1) {
    throw new Error('Choose a reviewed setupIntegrationDb.js, addBookingUpdate.js, addAuditLog.js or updateBillingRoutine.js entry point.');
  }
  const values = dotenv.parse(contents);
  const { configuration } = require('./setupRuntimeUser');
  configuration(values);
  const env = { ...environment };
  for (const key of Object.keys(env)) if (/^DB_(HOST|PORT|USER|PASSWORD|NAME)$/i.test(key)) delete env[key];
  for (const key of ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) env[key] = values[key] || (key === 'DB_PORT' ? '3306' : '');
  return { script: path.join(__dirname, script), args: rest, env };
}
if (require.main === module) {
  try {
    const task = command(process.argv.slice(2), fs.readFileSync(path.join(__dirname, '..', '.env.maintenance'), 'utf8'));
    const result = spawnSync(process.execPath, [task.script, ...task.args], { cwd: path.resolve(__dirname, '..'), env: task.env, stdio: 'inherit', shell: false });
    process.exitCode = result.status === 0 ? 0 : 1;
  } catch { console.error('Maintenance configuration or command is invalid. No script was started.'); process.exitCode = 1; }
}
module.exports = { command };
