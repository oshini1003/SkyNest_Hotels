const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });
if (!process.env.DB_USER) throw new Error('Set DB_USER explicitly in backend/.env.');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'SkyNest_Hotels',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true, // return DECIMAL columns as JS numbers, not strings
});

module.exports = pool;
