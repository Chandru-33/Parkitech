const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'parking.db');

const db = new sqlite3.Database(DB_PATH);

const COMMISSION_RATE = 0.30;

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('client', 'user')),
      total_earnings REAL DEFAULT 0,
      total_bookings INTEGER DEFAULT 0,
      pending_payout REAL DEFAULT 0,
      completed_payout REAL DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS parking_spaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      address TEXT NOT NULL,
      location_description TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      total_slots INTEGER NOT NULL,
      available_slots INTEGER,
      available_from TEXT NOT NULL,
      available_to TEXT NOT NULL,
      price_per_hour REAL NOT NULL,
      latitude REAL,
      longitude REAL,
      rating REAL,
      is_verified INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      parking_space_id INTEGER NOT NULL,
      parking_id INTEGER,
      vehicle_type TEXT,
      booking_date TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      total_price REAL NOT NULL,
      total_amount REAL,
      platform_commission REAL DEFAULT 0,
      owner_earnings REAL DEFAULT 0,
      payment_status TEXT DEFAULT 'Paid',
      booking_status TEXT DEFAULT 'Active',
      refund_amount REAL,
      refund_status TEXT,
      refund_date TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (parking_space_id) REFERENCES parking_spaces(id)
    )
  `);

  // Best-effort migration for older databases
  const addCol = (table, col, type) => {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`, () => {});
  };

  addCol('parking_spaces', 'available_slots', 'INTEGER');
  addCol('parking_spaces', 'latitude', 'REAL');
  addCol('parking_spaces', 'longitude', 'REAL');
  addCol('parking_spaces', 'rating', 'REAL');
  addCol('parking_spaces', 'is_verified', 'INTEGER DEFAULT 1');

  addCol('bookings', 'parking_id', 'INTEGER');
  addCol('bookings', 'vehicle_type', 'TEXT');
  addCol('bookings', 'booking_date', 'TEXT');
  addCol('bookings', 'total_amount', 'REAL');
  addCol('bookings', 'platform_commission', 'REAL DEFAULT 0');
  addCol('bookings', 'owner_earnings', 'REAL DEFAULT 0');
  addCol('bookings', 'payment_status', 'TEXT');
  addCol('bookings', 'booking_status', 'TEXT');
  addCol('bookings', 'refund_amount', 'REAL');
  addCol('bookings', 'refund_status', 'TEXT');
  addCol('bookings', 'refund_date', 'TEXT');

  addCol('users', 'total_earnings', 'REAL DEFAULT 0');
  addCol('users', 'total_bookings', 'INTEGER DEFAULT 0');
  addCol('users', 'pending_payout', 'REAL DEFAULT 0');
  addCol('users', 'completed_payout', 'REAL DEFAULT 0');

  // Seed demo owner
  db.run(
    `INSERT OR IGNORE INTO users (name, email, password_hash, role)
     VALUES ('SmartPark Host', 'host@smartpark.local', 'demo-hash', 'client')`
  );

  // Seed 10 Chennai locations only when they don't already exist
  db.get(
    'SELECT id FROM users WHERE email = ?',
    ['host@smartpark.local'],
    (userErr, userRow) => {
      if (userErr || !userRow) return;

      const ownerId = userRow.id;

      db.get(
        `SELECT COUNT(*) as count FROM parking_spaces
         WHERE title LIKE '%Pondy Bazaar%' AND owner_id = ?`,
        [ownerId],
        (countErr, row) => {
          if (countErr || (row && row.count > 0)) return;

          const stmt = db.prepare(
            `INSERT INTO parking_spaces
            (owner_id, title, address, location_description, vehicle_type,
             total_slots, available_slots, available_from, available_to,
             price_per_hour, latitude, longitude, rating, is_verified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );

          const spaces = [
            { title: 'T. Nagar – Pondy Bazaar Parking', address: 'Pondy Bazaar, T. Nagar, Chennai', description: 'Street-side and lot parking near Pondy Bazaar shopping district.', vehicle_type: 'both', total_slots: 40, available_slots: 12, from: '08:00', to: '22:00', price: 40, lat: 13.0418, lng: 80.2343, rating: 4.5 },
            { title: 'Anna Nagar – Tower Park Parking', address: 'Tower Park, Anna Nagar, Chennai', description: 'Designated parking near Anna Nagar Tower Park entrance.', vehicle_type: 'both', total_slots: 30, available_slots: 8, from: '06:00', to: '22:00', price: 35, lat: 13.0879, lng: 80.2103, rating: 4.4 },
            { title: 'Velachery – Phoenix Mall Parking', address: 'Phoenix MarketCity, Velachery, Chennai', description: 'Multi-level parking inside Phoenix MarketCity mall.', vehicle_type: 'four-wheeler', total_slots: 150, available_slots: 35, from: '09:00', to: '23:00', price: 60, lat: 12.9909, lng: 80.2168, rating: 4.7 },
            { title: 'Adyar – Besant Nagar Beach Parking', address: 'Elliots Beach, Besant Nagar, Chennai', description: 'Open-air parking near Besant Nagar / Elliots Beach.', vehicle_type: 'both', total_slots: 50, available_slots: 10, from: '05:00', to: '23:00', price: 30, lat: 13.0007, lng: 80.2663, rating: 4.3 },
            { title: 'Central – Chennai Central Railway Station Parking', address: 'Chennai Central Railway Station, Park Town', description: 'Structured parking near Chennai Central terminal.', vehicle_type: 'four-wheeler', total_slots: 120, available_slots: 20, from: '00:00', to: '23:59', price: 50, lat: 13.0827, lng: 80.2757, rating: 4.6 },
            { title: 'Egmore – Egmore Railway Station Parking', address: 'Egmore Railway Station, Egmore, Chennai', description: 'Railway station parking for short and long stays.', vehicle_type: 'both', total_slots: 70, available_slots: 9, from: '00:00', to: '23:59', price: 45, lat: 13.0734, lng: 80.2606, rating: 4.2 },
            { title: 'OMR – Sholinganallur IT Park Parking', address: 'Sholinganallur, OMR, Chennai', description: 'Dedicated parking for IT park visitors and employees.', vehicle_type: 'four-wheeler', total_slots: 90, available_slots: 18, from: '07:00', to: '22:00', price: 55, lat: 12.8996, lng: 80.2279, rating: 4.4 },
            { title: 'Guindy – Industrial Estate Parking', address: 'Guindy Industrial Estate, Chennai', description: 'Commercial parking near Guindy Industrial Estate.', vehicle_type: 'both', total_slots: 60, available_slots: 14, from: '07:00', to: '21:00', price: 35, lat: 13.0108, lng: 80.2121, rating: 4.1 },
            { title: 'Tambaram – Bus Stand Parking', address: 'Tambaram Bus Stand, Tambaram, Chennai', description: 'Parking for commuters near Tambaram bus terminus.', vehicle_type: 'both', total_slots: 55, available_slots: 7, from: '05:00', to: '23:00', price: 25, lat: 12.9229, lng: 80.1275, rating: 4.0 },
            { title: 'Mylapore – Kapaleeshwarar Temple Parking', address: 'Kapaleeshwarar Temple, Mylapore, Chennai', description: 'Temple-adjacent parking for visitors and locals.', vehicle_type: 'both', total_slots: 45, available_slots: 11, from: '05:00', to: '22:00', price: 30, lat: 13.0331, lng: 80.2707, rating: 4.5 },
          ];

          spaces.forEach((s) => {
            stmt.run(ownerId, s.title, s.address, s.description, s.vehicle_type, s.total_slots, s.available_slots, s.from, s.to, s.price, s.lat, s.lng, s.rating, 1);
          });

          stmt.finalize();
        }
      );
    }
  );
});

module.exports = db;
module.exports.COMMISSION_RATE = COMMISSION_RATE;
