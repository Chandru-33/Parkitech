const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '3369',
  database: process.env.DB_NAME || 'smartparkitech',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Ensure schema: password, commission columns, client earnings
async function ensureSchema() {
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.query('ALTER TABLE users ADD COLUMN password VARCHAR(255) NULL').catch((e) => {
      if (e.code !== 'ER_DUP_FIELDNAME') console.error('⚠️ users.password:', e.message);
    });
    await conn.query('ALTER TABLE bookings ADD COLUMN commission DECIMAL(10,2) DEFAULT 0').catch((e) => {
      if (e.code !== 'ER_DUP_FIELDNAME') console.error('⚠️ bookings.commission:', e.message);
    });
    await conn.query('ALTER TABLE bookings ADD COLUMN client_amount DECIMAL(10,2) DEFAULT 0').catch((e) => {
      if (e.code !== 'ER_DUP_FIELDNAME') console.error('⚠️ bookings.client_amount:', e.message);
    });
    await conn.query('ALTER TABLE bookings ADD COLUMN client_id INT NULL').catch((e) => {
      if (e.code !== 'ER_DUP_FIELDNAME') console.error('⚠️ bookings.client_id:', e.message);
    });
    await conn.query('ALTER TABLE bookings ADD COLUMN booking_time DATETIME NULL').catch((e) => {
      if (e.code !== 'ER_DUP_FIELDNAME') console.error('⚠️ bookings.booking_time:', e.message);
    });
    await conn.query('ALTER TABLE client ADD COLUMN total_earnings DECIMAL(10,2) DEFAULT 0').catch((e) => {
      if (e.code !== 'ER_DUP_FIELDNAME') console.error('⚠️ client.total_earnings:', e.message);
    });
    await conn.query('ALTER TABLE client ADD COLUMN user_id INT NULL').catch((e) => {
      if (e.code !== 'ER_DUP_FIELDNAME') console.error('⚠️ client.user_id:', e.message);
    });
  } catch (err) {
    console.error('❌ Schema check failed:', err.message);
  } finally {
    if (conn) conn.release();
  }
}

pool.getConnection()
  .then(async (conn) => {
    console.log('✅ MySQL Connected');
    conn.release();
    await ensureSchema();
  })
  .catch((err) => console.error('❌ Database connection failed:', err.message));

module.exports = pool;
