require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const expressLayouts = require('express-ejs-layouts');
const db = require('./config/db');

const app = express();

// =========================
// 🔹 MIDDLEWARE
// =========================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

// =========================
// 🔹 SESSION SETUP
// =========================
app.use(
  session({
    secret: 'smartpark-secret',
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// Enrich session with user name for layout (session stores only id, role)
app.use(async (req, res, next) => {
  if (req.session.user && !req.session.user.name) {

    try {
      const [[u]] = await db.query('SELECT name FROM users WHERE id = ?', [req.session.user.id]);
      if (u) req.session.user.name = u.name;
    } catch (e) { /* ignore */ }
  }
  next();
});

// =========================
// 🔹 AUTH HELPERS
// =========================
const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};

const requireRole = (role) => (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  if (req.session.user.role !== role) return res.status(403).send('Forbidden');
  next();
};

// Helper: safe date handling to avoid RangeError
function safeDateISO(val) {
  if (val == null || val === '') return null;
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return null;
  try { return d.toISOString(); } catch (e) { return null; }
}
function safeDate(val) {
  if (val == null || val === '') return null;
  const d = new Date(val);
  return !Number.isNaN(d.getTime()) ? d : null;
}

// =========================
// 🔹 ROUTES
// =========================

app.get('/', (req, res) => {
  res.render('index');
});

// REGISTER
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password || !role) {
      return res.render('register', { error: 'All fields are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const [rows] = await db.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
    if (rows.length > 0) {
      return res.render('register', { error: 'Email is already registered. Please log in.' });
    }
    const [result] = await db.query(
      'INSERT INTO users (name, email, password, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      [name, normalizedEmail, password, password, role]
    );
    req.session.user = { id: result.insertId, role };
    if (role === 'client') {
      try {
        await db.query(
          'INSERT INTO client (name, email, password_hash, user_id) VALUES (?, ?, ?, ?)',
          [name, normalizedEmail, password, result.insertId]
        );
      } catch (e) {
        // client row may already exist
      }
    }
    const redirectTo = role === 'client' ? '/client-dashboard' : '/dashboard';
    res.redirect(redirectTo);
  } catch (err) {
    console.error(err);
    res.render('register', { error: 'Database error. Please try again.' });
  }
});

// LOGIN
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.render('login', { error: 'Email and password are required.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const [results] = await db.query('SELECT * FROM users WHERE email = ? AND password = ?', [
      normalizedEmail,
      password,
    ]);
    if (results.length === 0) {
      return res.render('login', { error: 'Invalid email or password.' });
    }
    const user = results[0];
    req.session.user = { id: user.id, role: user.role };
    const redirectTo = user.role === 'client' ? '/client-dashboard' : '/dashboard';
    res.redirect(redirectTo);
  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Database error. Please try again.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// =========================
// CLIENT ROUTES
// =========================

// GET /client-dashboard – Bookings on your slots + Your Parking Spaces
app.get('/client-dashboard', requireRole('client'), async (req, res) => {
  try {
    const ownerId = req.session.user.id;
    const [bookings] = await db.query(
      `SELECT b.*, u.name AS user_name, u.email, ps.title AS parking_name
       FROM bookings b
       JOIN users u ON b.user_id = u.id
       JOIN parking_spaces ps ON b.parking_space_id = ps.id
       WHERE ps.owner_id = ?
       ORDER BY b.id DESC`,
      [ownerId]
    );
    const activeBookings = bookings.filter((b) => (b.booking_status || b.status) !== 'Cancelled');
    const [spaces] = await db.query(
      'SELECT * FROM parking_spaces WHERE owner_id = ? ORDER BY id DESC',
      [ownerId]
    );
    const stats = {
      total_earnings: activeBookings.reduce((s, b) => s + (Number(b.client_amount) || Number(b.amount) || 0), 0),
      total_bookings: bookings.length,
      pending_payout: 0,
      today_earnings: 0,
    };
    res.render('client_dashboard', {
      stats,
      monthlyData: [],
      bookings: bookings.map((b) => {
        const startStr = b.booking_date && b.start_time
          ? `${b.booking_date}T${String(b.start_time).slice(0, 8)}`
          : (b.created_at || null);
        const endStr = b.booking_date && b.end_time
          ? `${b.booking_date}T${String(b.end_time).slice(0, 8)}`
          : null;
        return {
          ...b,
          booking_status: b.booking_status || b.status || 'Active',
          total_amount: b.amount,
          start_time: safeDateISO(startStr) || safeDateISO(b.start_time),
          end_time: safeDateISO(endStr) || safeDateISO(b.end_time),
        };
      }),
      spaces,
      commissionRate: 0.1,
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('client_dashboard', {
      stats: { total_earnings: 0, total_bookings: 0, pending_payout: 0, today_earnings: 0 },
      monthlyData: [],
      bookings: [],
      spaces: [],
      commissionRate: 0.1,
    });
  }
});

// POST /delete-parking/:id – Delete parking slot (owner only)
app.post('/delete-parking/:id', requireRole('client'), async (req, res) => {
  try {
    const spaceId = parseInt(req.params.id, 10);
    const ownerId = req.session.user.id;
    const [result] = await db.query(
      'DELETE FROM parking_spaces WHERE id = ? AND owner_id = ?',
      [spaceId, ownerId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).send('Parking space not found or you do not have permission to delete it.');
    }
    res.redirect('/my-parkings');
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not delete parking space.');
  }
});

// GET /my-parkings – Your Parking Spaces
app.get('/my-parkings', requireRole('client'), async (req, res) => {
  try {
    const ownerId = req.session.user.id;
    const [spaces] = await db.query(
      'SELECT * FROM parking_spaces WHERE owner_id = ? ORDER BY id DESC',
      [ownerId]
    );
    res.render('my_parkings', { spaces });
  } catch (err) {
    console.error(err);
    res.render('my_parkings', { spaces: [] });
  }
});

// Add parking form
app.get('/client/parking/new', requireRole('client'), (req, res) => {
  res.render('parking_new', { error: null });
});

// POST /add-parking – Insert into client table
app.post('/add-parking', requireRole('client'), async (req, res) => {
  try {
    const ownerId = req.session.user.id;
    const {
      title,
      address,
      location_description,
      vehicle_type,
      total_slots,
      available_from,
      available_to,
      price_per_hour,
    } = req.body;

    if (
      !title ||
      !address ||
      !location_description ||
      !vehicle_type ||
      !total_slots ||
      !available_from ||
      !available_to ||
      !price_per_hour
    ) {
      return res.render('parking_new', { error: 'All fields are required.' });
    }

    const total = Math.max(1, parseInt(total_slots, 10) || 1);
    await db.query(
      `INSERT INTO parking_spaces
        (owner_id, title, address, location, location_description, vehicle_type, total_slots, available_slots, available_from, available_to, price_per_hour)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ownerId,
        title,
        address,
        address,
        location_description,
        vehicle_type,
        total,
        total,
        available_from,
        available_to,
        price_per_hour,
      ]
    );
    res.redirect('/my-parkings');
  } catch (err) {
    console.error(err);
    res.render('parking_new', {
      error: 'Could not save parking space. Please try again.',
    });
  }
});

// Legacy form posts here – same logic as /add-parking
app.post('/client/parking/new', requireRole('client'), async (req, res) => {
  try {
    const ownerId = req.session.user.id;
    const {
      title,
      address,
      location_description,
      vehicle_type,
      total_slots,
      available_from,
      available_to,
      price_per_hour,
    } = req.body;
    if (
      !title ||
      !address ||
      !location_description ||
      !vehicle_type ||
      !total_slots ||
      !available_from ||
      !available_to ||
      !price_per_hour
    ) {
      return res.render('parking_new', { error: 'All fields are required.' });
    }
    const total = Math.max(1, parseInt(total_slots, 10) || 1);
    await db.query(
      `INSERT INTO parking_spaces
        (owner_id, title, address, location, location_description, vehicle_type, total_slots, available_slots, available_from, available_to, price_per_hour)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ownerId,
        title,
        address,
        address,
        location_description,
        vehicle_type,
        total,
        total,
        available_from,
        available_to,
        price_per_hour,
      ]
    );
    res.redirect('/my-parkings');
  } catch (err) {
    console.error(err);
    res.render('parking_new', { error: 'Could not save parking space. Please try again.' });
  }
});

// =========================
// USER ROUTES
// =========================

// GET /user-dashboard – Recent Bookings
app.get('/user-dashboard', requireRole('user'), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const [bookings] = await db.query(
      `SELECT b.*, ps.location, ps.address AS parking_address, ps.title AS parking_name
       FROM bookings b
       JOIN parking_spaces ps ON b.parking_space_id = ps.id
       WHERE b.user_id = ?
       ORDER BY b.id DESC`,
      [userId]
    );
    res.render('user_dashboard_bookings', { bookings });
  } catch (err) {
    console.error(err);
    res.render('user_dashboard_bookings', { bookings: [] });
  }
});

// Search parking (use parking_spaces table)
app.get('/user/search', requireRole('user'), async (req, res) => {
  try {
    const { location, vehicle_type, sort } = req.query;
    let sql = `
      SELECT ps.*, u.name AS owner_name
      FROM parking_spaces ps
      JOIN users u ON ps.owner_id = u.id
      WHERE (ps.available_slots IS NULL OR ps.available_slots > 0) AND 1=1
    `;
    const params = [];

    if (vehicle_type) {
      sql += ' AND (ps.vehicle_type = ? OR ps.vehicle_type = "both")';
      params.push(vehicle_type);
    }
    if (location) {
      const like = `%${location}%`;
      sql += ' AND (ps.address LIKE ? OR ps.location LIKE ? OR ps.location_description LIKE ?)';
      params.push(like, like, like);
    }
    if (sort === 'price') sql += ' ORDER BY ps.price_per_hour ASC';
    else if (sort === 'availability') sql += ' ORDER BY COALESCE(ps.available_slots, 0) DESC';
    else sql += ' ORDER BY ps.id DESC';

    const [rows] = await db.query(sql, params);
    res.render('user_dashboard', {
      query: req.query,
      spaces: rows,
      hasUserLocation: !!(req.query.user_lat && req.query.user_lng),
      nearbyCount: rows.length,
    });
  } catch (err) {
    console.error(err);
    res.render('user_dashboard', {
      query: req.query,
      spaces: [],
      hasUserLocation: false,
      nearbyCount: 0,
    });
  }
});

// Chatbot: get available locations
app.get('/chatbot/get-locations', requireRole('user'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, title, address, location, location_description, price_per_hour,
              total_slots, available_slots
       FROM parking_spaces
       WHERE (available_slots IS NULL OR available_slots > 0)`
    );
    res.json({ locations: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not fetch locations' });
  }
});

// Chatbot: check availability for requested time
app.post('/chatbot/check-availability', requireRole('user'), async (req, res) => {
  try {
    const { spaceId, start_time, duration_minutes } = req.body;
    const duration = Math.max(30, parseInt(duration_minutes, 10) || 60);
    const start = new Date(start_time);
    if (Number.isNaN(start.getTime())) {
      return res.status(400).json({ available: false, message: 'Invalid start time' });
    }
    const end = new Date(start.getTime() + duration * 60000);

    const [[space]] = await db.query(
      'SELECT id, title, address, price_per_hour, available_slots FROM parking_spaces WHERE id = ?',
      [spaceId]
    );
    if (!space) return res.json({ available: false, message: 'Space not found' });
    if ((space.available_slots || 0) <= 0) {
      return res.json({ available: false, message: 'No slots available' });
    }

    const hours = Math.max(0.5, duration / 60);
    const amount = (Number(space.price_per_hour) || 0) * hours;

    res.json({
      available: true,
      space,
      amount,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      human_start: start.toLocaleString(),
      human_duration: `${hours.toFixed(1)} hour(s)`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ available: false, message: 'Error checking availability' });
  }
});

// Chatbot: book slot (JSON flow)
app.post('/chatbot/book-slot', requireRole('user'), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { spaceId, start_time, end_time, duration_minutes, vehicle_number } = req.body;

    const start = new Date(start_time);
    const end = new Date(end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ success: false, message: 'Invalid time range' });
    }

    const [[parking]] = await db.query(
      'SELECT owner_id, price_per_hour, available_slots, title, address FROM parking_spaces WHERE id = ?',
      [spaceId]
    );
    if (!parking) return res.json({ success: false, message: 'Parking not found' });
    if ((parking.available_slots || 0) <= 0) {
      return res.json({ success: false, message: 'No slots available' });
    }

    const durationHrs = Math.max(0.5, (end - start) / 3600000);
    const amount = (Number(parking.price_per_hour) || 0) * durationHrs;
    const commission = Math.round(amount * COMMISSION_RATE * 100) / 100;
    const clientAmount = Math.round((amount - commission) * 100) / 100;
    const clientId = parking.owner_id;

    const bookingDate = start.toISOString().split('T')[0];
    const startTimeStr = start.toTimeString().slice(0, 8);
    const endTimeStr = end.toTimeString().slice(0, 8);
    // Store MySQL-friendly DATETIME (YYYY-MM-DD HH:MM:SS)
    const bookingTime = `${bookingDate} ${startTimeStr}`;

    const conn = await db.getConnection();
    let bookingRow;
    try {
      await conn.beginTransaction();
      const [ins] = await conn.query(
        `INSERT INTO bookings (user_id, parking_space_id, client_id, booking_date, start_time, end_time,
                               booking_time, vehicle_number, amount, commission, client_amount, status, booking_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'Active')`,
        [
          userId,
          spaceId,
          clientId,
          bookingDate,
          startTimeStr,
          endTimeStr,
          bookingTime,
          vehicle_number || null,
          amount,
          commission,
          clientAmount,
        ]
      );

      const [ur] = await conn.query(
        'UPDATE client SET total_earnings = COALESCE(total_earnings, 0) + ? WHERE user_id = ?',
        [clientAmount, clientId]
      );
      if (!ur || ur.affectedRows === 0) {
        await conn.query(
          'UPDATE client SET total_earnings = COALESCE(total_earnings, 0) + ? WHERE id = ?',
          [clientAmount, clientId]
        );
      }

      await conn.query(
        'UPDATE parking_spaces SET available_slots = ? WHERE id = ?',
        [Math.max(0, (parking.available_slots || 1) - 1), spaceId]
      );

      await conn.commit();
      bookingRow = { id: ins.insertId, amount, commission, client_amount: clientAmount };
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    res.json({ success: true, booking: bookingRow });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Could not complete booking' });
  }
});

// Chatbot: generate booking receipt (HTML, printable as PDF)
app.get('/chatbot/generate-receipt', requireRole('user'), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const bookingId = parseInt(req.query.bookingId, 10);
    if (!bookingId) return res.status(400).json({ error: 'Invalid booking ID' });

    const [[b]] = await db.query(
      `SELECT b.*, ps.title AS parking_name, ps.address AS parking_address
       FROM bookings b
       JOIN parking_spaces ps ON b.parking_space_id = ps.id
       WHERE b.id = ? AND b.user_id = ?`,
      [bookingId, userId]
    );
    if (!b) return res.status(404).json({ error: 'Booking not found' });

    const startStr = b.booking_date && b.start_time
      ? `${b.booking_date} ${String(b.start_time).slice(0, 8)}`
      : b.booking_time || b.created_at;
    const start = safeDate(startStr);
    const created = safeDate(b.created_at || b.booking_time || startStr);

    const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Booking Receipt #${b.id}</title>
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 24px; }
      h1 { margin-bottom: 4px; }
      h2 { margin-top: 24px; margin-bottom: 8px; }
      .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; max-width: 480px; }
      .row { margin: 4px 0; }
      .label { color: #6b7280; font-size: 0.85rem; }
      .value { font-size: 0.92rem; }
      hr { margin: 16px 0; border: none; border-top: 1px solid #e5e7eb; }
      button { margin-top: 12px; padding: 6px 12px; border-radius: 999px; border: 1px solid #111827; background: #111827; color: #fff; cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>Booking Receipt</h1>
    <div class="card">
      <div class="row"><span class="label">Booking ID</span><br/><span class="value">#${b.id}</span></div>
      <div class="row"><span class="label">Parking Location</span><br/><span class="value">${b.parking_name || ''}, ${b.parking_address || ''}</span></div>
      <div class="row"><span class="label">Vehicle Number</span><br/><span class="value">${b.vehicle_number || '-'}</span></div>
      <div class="row"><span class="label">Start Time</span><br/><span class="value">${start ? start.toLocaleString() : '-'}</span></div>
      <div class="row"><span class="label">Duration</span><br/><span class="value">${b.duration || ''} hour(s)</span></div>
      <div class="row"><span class="label">Amount Paid</span><br/><span class="value">₹${(Number(b.amount) || 0).toFixed(2)}</span></div>
      <div class="row"><span class="label">Date</span><br/><span class="value">${created ? created.toLocaleString() : '-'}</span></div>
    </div>
    <button onclick="window.print()">Download / Print as PDF</button>
  </body>
</html>`;

    res.json({ html });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not generate receipt' });
  }
});

app.get('/find-parking', requireRole('client'), (req, res) => res.redirect('/client-dashboard'));
app.get('/dashboard', requireRole('user'), (req, res) => res.redirect('/user-dashboard'));

// Legacy redirects
app.get('/user/dashboard', requireRole('user'), (req, res) => res.redirect('/dashboard'));
app.get('/client/dashboard', requireRole('client'), (req, res) => res.redirect('/client-dashboard'));

// Book form (GET)
app.get('/user/book/:id', requireRole('user'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ps.*, u.name AS owner_name FROM parking_spaces ps JOIN users u ON ps.owner_id = u.id WHERE ps.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).send('Parking space not found');
    const space = rows[0];
    space.location_description = space.location_description || space.location;
    res.render('booking_new', { space, error: null });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error loading parking space');
  }
});

// POST /book-slot/:id – Transaction: insert booking (with commission), update client earnings, update slots
const COMMISSION_RATE = 0.1;

app.post('/book-slot/:id', requireRole('user'), async (req, res) => {
  try {
    const parkingSpaceId = parseInt(req.params.id, 10);
    const userId = req.session.user.id;
    const { start_time, end_time, vehicle_number } = req.body;

    if (!start_time || !end_time) {
      const [rows] = await db.query(
        `SELECT ps.*, u.name AS owner_name FROM parking_spaces ps JOIN users u ON ps.owner_id = u.id WHERE ps.id = ?`,
        [parkingSpaceId]
      );
      if (rows.length === 0) return res.status(404).send('Parking not found');
      const space = rows[0];
      space.location_description = space.location_description || space.location;
      return res.render('booking_new', {
        space,
        error: 'Please provide start and end time.',
      });
    }

    const start = new Date(start_time);
    const end = new Date(end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      try {
        const [rows] = await db.query(
          `SELECT ps.*, u.name AS owner_name FROM parking_spaces ps JOIN users u ON ps.owner_id = u.id WHERE ps.id = ?`,
          [parkingSpaceId]
        );
        const space = rows[0] ? { ...rows[0], location_description: rows[0].location_description || rows[0].location } : null;
        return res.render('booking_new', {
          space: space || { id: parkingSpaceId, title: '', address: '', owner_name: '', vehicle_type: '', available_from: '', available_to: '', price_per_hour: '' },
          error: 'Invalid date or time. Please provide valid start and end datetime.',
        });
      } catch (e) {
        return res.status(400).send('Invalid date or time. Please try again.');
      }
    }
    if (end <= start) {
      try {
        const [rows] = await db.query(
          `SELECT ps.*, u.name AS owner_name FROM parking_spaces ps JOIN users u ON ps.owner_id = u.id WHERE ps.id = ?`,
          [parkingSpaceId]
        );
        const space = rows[0] ? { ...rows[0], location_description: rows[0].location_description || rows[0].location } : null;
        return res.render('booking_new', {
          space: space || { id: parkingSpaceId, title: '', address: '', owner_name: '', vehicle_type: '', available_from: '', available_to: '', price_per_hour: '' },
          error: 'End time must be after start time.',
        });
      } catch (e) {
        return res.status(400).send('End time must be after start time.');
      }
    }
    const durationHrs = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60)));
    const bookingDate = start.toISOString().split('T')[0];
    const startTimeStr = start.toTimeString().slice(0, 8);
    const endTimeStr = end.toTimeString().slice(0, 8);
    const bookingTime = start_time;

    const [[parking]] = await db.query(
      'SELECT owner_id, price_per_hour, available_slots, title, address FROM parking_spaces WHERE id = ?',
      [parkingSpaceId]
    );
    if (!parking) return res.status(404).send('Parking not found');
    const availSlots = Number(parking.available_slots) ?? 1;
    if (availSlots <= 0) {
      try {
        const [rows] = await db.query(
          `SELECT ps.*, u.name AS owner_name FROM parking_spaces ps JOIN users u ON ps.owner_id = u.id WHERE ps.id = ?`,
          [parkingSpaceId]
        );
        const space = rows[0] ? { ...rows[0], location_description: rows[0].location_description || rows[0].location } : null;
        return res.render('booking_new', {
          space: space || { id: parkingSpaceId, title: parking.title, address: parking.address, owner_name: '', vehicle_type: '', available_from: '', available_to: '', price_per_hour: parking.price_per_hour },
          error: 'No slots available for this parking space.',
        });
      } catch (e) {
        return res.status(400).send('No slots available.');
      }
    }

    const amount = (Number(parking.price_per_hour) || 0) * durationHrs;
    const commission = Math.round(amount * COMMISSION_RATE * 100) / 100;
    const clientAmount = Math.round((amount - commission) * 100) / 100;
    const clientId = parking.owner_id;

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO bookings (user_id, parking_space_id, client_id, booking_date, start_time, end_time, booking_time, vehicle_number, amount, commission, client_amount, status, booking_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', 'Active')`,
        [userId, parkingSpaceId, clientId, bookingDate, startTimeStr, endTimeStr, bookingTime, vehicle_number || null, amount, commission, clientAmount]
      );

      const [ur] = await conn.query(
        `UPDATE client SET total_earnings = COALESCE(total_earnings, 0) + ? WHERE user_id = ?`,
        [clientAmount, clientId]
      );
      if (ur && ur.affectedRows === 0) {
        await conn.query(
          `UPDATE client SET total_earnings = COALESCE(total_earnings, 0) + ? WHERE id = ?`,
          [clientAmount, clientId]
        );
      }

      await conn.query(
        'UPDATE parking_spaces SET available_slots = ? WHERE id = ?',
        [Math.max(0, (parking.available_slots || 1) - 1), parkingSpaceId]
      );

      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }

    req.session.bookingConfirm = {
      clientAmount,
      commission,
      amount,
      commissionPercent: COMMISSION_RATE * 100,
    };
    res.redirect('/booking-confirmed');
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not complete booking. Please try again.');
  }
});

// GET /booking-confirmed – after successful booking
app.get('/booking-confirmed', requireRole('user'), (req, res) => {
  const data = req.session.bookingConfirm || {
    clientAmount: 0,
    commission: 0,
    amount: 0,
    commissionPercent: 10,
  };
  delete req.session.bookingConfirm;
  res.render('booking_confirm', {
    clientAmount: data.clientAmount,
    commission: data.commission,
    amount: data.amount,
    commissionPercent: data.commissionPercent,
    message: `₹${data.clientAmount} credited to client after ${data.commissionPercent}% commission deduction.`,
  });
});

// GET /my-earnings – client earnings page (join booking + parking_spaces + client)
app.get('/my-earnings', requireRole('client'), async (req, res) => {
  try {
    const ownerId = req.session.user.id;
    const [[clientRow]] = await db.query(
      'SELECT COALESCE(total_earnings, total_earned, 0) AS total_earnings FROM client WHERE user_id = ? OR id = ? LIMIT 1',
      [ownerId, ownerId]
    );
    const totalEarnings = clientRow ? Number(clientRow.total_earnings || 0) : 0;

    const [bookings] = await db.query(
      `SELECT b.id, b.amount, b.commission, b.client_amount, b.booking_time, b.booking_date, b.start_time, b.created_at, b.booking_status, ps.title AS parking_name
       FROM bookings b
       JOIN parking_spaces ps ON b.parking_space_id = ps.id
       WHERE ps.owner_id = ? AND (b.booking_status IS NULL OR b.booking_status != 'Cancelled')
       ORDER BY COALESCE(b.booking_time, b.created_at) DESC`,
      [ownerId]
    );

    const totalCommission = bookings.reduce((s, b) => s + (Number(b.commission) || 0), 0);
    const netEarnings = bookings.reduce((s, b) => s + (Number(b.client_amount) || 0), 0);

    res.render('my_earnings', {
      totalEarnings,
      totalCommission,
      netEarnings,
      totalBookings: bookings.length,
      bookings,
    });
  } catch (err) {
    console.error(err);
    res.render('my_earnings', { totalEarnings: 0, totalCommission: 0, netEarnings: 0, totalBookings: 0, bookings: [] });
  }
});

// POST /user/bookings/:id/cancel – Cancel booking, revert slot, deduct from client earnings
app.post('/user/bookings/:id/cancel', requireRole('user'), async (req, res) => {
  try {
    const bookingId = parseInt(req.params.id, 10);
    const userId = req.session.user.id;

    const [[booking]] = await db.query(
      `SELECT b.*, ps.owner_id, ps.available_slots FROM bookings b
       JOIN parking_spaces ps ON b.parking_space_id = ps.id
       WHERE b.id = ? AND b.user_id = ? AND (b.booking_status = 'Active' OR b.booking_status IS NULL)`,
      [bookingId, userId]
    );
    if (!booking) {
      return res.status(404).send('Booking not found or cannot be cancelled.');
    }

    const clientAmount = Number(booking.client_amount) || 0;
    const clientId = booking.client_id || booking.owner_id;
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(
        "UPDATE bookings SET booking_status = 'Cancelled' WHERE id = ?",
        [bookingId]
      );
      await conn.query(
        'UPDATE parking_spaces SET available_slots = COALESCE(available_slots, 0) + 1 WHERE id = ?',
        [booking.parking_space_id]
      );
      if (clientAmount > 0 && clientId) {
        const [ur] = await conn.query(
          'UPDATE client SET total_earnings = GREATEST(0, COALESCE(total_earnings, 0) - ?) WHERE user_id = ?',
          [clientAmount, clientId]
        );
        if (ur.affectedRows === 0) {
          await conn.query(
            'UPDATE client SET total_earnings = GREATEST(0, COALESCE(total_earnings, 0) - ?) WHERE id = ?',
            [clientAmount, clientId]
          );
        }
      }
      await conn.commit();
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
    res.redirect('/user/bookings');
  } catch (err) {
    console.error(err);
    res.status(500).send('Could not cancel booking.');
  }
});

// User bookings list (compatible with existing my_bookings view)
app.get('/user/bookings', requireRole('user'), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const statusFilter = req.query.status || 'all';
    let sql = `
      SELECT b.*, ps.title AS parking_name, ps.address AS parking_address
      FROM bookings b
      JOIN parking_spaces ps ON b.parking_space_id = ps.id
      WHERE b.user_id = ?
    `;
    const params = [userId];
    if (['Active', 'Completed', 'Cancelled'].includes(statusFilter)) {
      sql += ' AND b.booking_status = ?';
      params.push(statusFilter);
    }
    sql += ' ORDER BY b.id DESC';

    const [rows] = await db.query(sql, params);
    const bookings = rows.map((b) => {
      const startStr = b.booking_date && b.start_time
        ? `${b.booking_date}T${String(b.start_time).slice(0, 8)}`
        : b.created_at;
      const endStr = b.booking_date && b.end_time
        ? `${b.booking_date}T${String(b.end_time).slice(0, 8)}`
        : null;
      const startDate = safeDate(startStr);
      const endDate = endStr ? safeDate(endStr) : (startDate ? new Date(startDate.getTime() + 3600000) : null);
      return {
        ...b,
        start_time: safeDateISO(startStr) || (startDate ? startDate.toISOString() : null),
        end_time: safeDateISO(endStr) || (endDate ? endDate.toISOString() : null),
        booking_status: b.booking_status || b.status || 'Active',
        total_amount: b.amount,
      };
    });
    res.render('my_bookings', { bookings, statusFilter: statusFilter === 'all' ? 'all' : statusFilter });
  } catch (err) {
    console.error(err);
    res.render('my_bookings', { bookings: [], statusFilter: 'all' });
  }
});

// =========================
// SERVER START
// =========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
