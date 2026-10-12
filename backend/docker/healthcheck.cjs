'use strict';

const mysql = require('mysql2/promise');

async function main() {
  const response = await fetch('http://127.0.0.1:5000/api/health', {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok || (await response.json()).status !== 'ok') {
    throw new Error('API is not ready');
  }
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 2500,
  });
  try {
    await connection.query({ sql: 'SELECT BranchID FROM BRANCH LIMIT 1', timeout: 2500 });
  } finally {
    await connection.end();
  }
}

main().catch(() => {
  // Docker stores healthcheck output. Do not put SQL or credentials there.
  console.error('Backend or database is not ready.');
  process.exitCode = 1;
});
