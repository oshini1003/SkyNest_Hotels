'use strict';

// Run with the Node.js already used by the project; no npm install required.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function makeEnvironment() {
  const random = () => crypto.randomBytes(32).toString('hex');
  return [
    '# Generated for the local SkyNest Docker demo. Do not commit or share.',
    '# Keep this file with the existing Docker database volume.',
    'WEB_PORT=8080',
    `DB_ROOT_PASSWORD=${random()}`,
    `DB_PASSWORD=${random()}`,
    `JWT_SECRET=${random()}`,
    `JWT_REFRESH_SECRET=${random()}`,
    '',
  ].join('\n');
}

function writeEnvironment(root) {
  if (!fs.existsSync(path.join(root, 'compose.yaml'))) {
    throw new Error('compose.yaml is missing. Apply the complete Docker package first.');
  }
  const target = path.join(root, '.env');
  try {
    fs.writeFileSync(target, makeEnvironment(), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('A root .env already exists; nothing was overwritten. Reuse it if Docker was configured before, otherwise review it before proceeding.');
    }
    throw error;
  }
  return target;
}

if (require.main === module) {
  try {
    writeEnvironment(path.resolve(__dirname, '..'));
    console.log('Created the project-root .env with unique database and JWT secrets.');
    console.log('backend/.env is unchanged. Next: docker compose config --quiet');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { makeEnvironment, writeEnvironment };
