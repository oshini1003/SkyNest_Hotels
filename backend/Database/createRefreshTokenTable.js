const pool = require('../config/db');

async function createTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS REFRESH_TOKEN (
      TokenID INT AUTO_INCREMENT PRIMARY KEY,
      UserType ENUM('guest', 'staff') NOT NULL,
      UserID INT NOT NULL,
      Token VARCHAR(500) NOT NULL UNIQUE,
      ExpiresAt DATETIME NOT NULL,
      RevokedAt DATETIME NULL,
      CreatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_refresh_token (Token),
      INDEX idx_user_tokens (UserType, UserID)
    ) ENGINE=InnoDB;
  `;
  await pool.query(query);
  console.log('REFRESH_TOKEN table created or verified successfully.');
  process.exit(0);
}

createTable().catch((err) => {
  console.error('Failed to create REFRESH_TOKEN table:', err);
  process.exit(1);
});

