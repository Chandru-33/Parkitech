const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const expressLayouts = require('express-ejs-layouts');
const db = require('./db');

const COMMISSION_RATE = db.COMMISSION_RATE || 0.30;

const app = express();
const PORT = process.env.PORT || 3000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function attachDistances(spaces, lat, lng) {
  spaces.forEach((space) => {
    if (
      typeof space.latitude === 'number' &&
      typeof space.longitude === 'number' &&
      !Number.isNaN(space.latitude) &&
      !Number.isNaN(space.longitude)
    ) {
      space.distance_km = haversineKm(lat, lng, space.latitude, space.longitude);
    } else {
      space.distance_km = null;
    }
  });
}

function sortSpaces(spaces, sortBy) {
  spaces.sort((a, b) => {
    if (sortBy === 'price') {
      return (a.price_per_hour || 0) - (b.price_per_hour || 0);
    }
    if (sortBy === 'availability') {
      return (b.available_slots || 0) - (a.available_slots || 0);
    }
    const da = typeof a.distance_km === 'number' ? a.distance_km : Number.POSITIVE_INFINITY;
    const dbv = typeof b.distance_km === 'number' ? b.distance_km : Number.POSITIVE_INFINITY;
    return da - dbv;
  });
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layout');

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(
  session({
    secret: 'super-secret-parking-key',
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

// --------------- Public routes ---------------

app.get('/', (req, res) => res.render('index'));

app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res.render('register', { error: 'All fields are required.' });
  }
  if (!['client', 'user'].includes(role)) {
    return res.render('register', { error: 'Invalid role selected.' });
  }
  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const stmt = db.prepare(
      'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
    );
    stmt.run(name, email, passwordHash, role, function (err) {
      if (err) {
        const message = err.message && err.message.includes('UNIQUE')
          ? 'Email already registered. Please log in.'
          : 'Something went wrong. Try a different email.';
        return res.render('register', { error: message });
      }
      req.session.user = { id: this.lastID, name, email, role };
      return res.redirect(role === 'client' ? '/client/dashboard' : '/user/dashboard');
    });
  } catch {
    return res.render('register', { error: 'Server error. Please try again.' });
  }
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.render('login', { error: 'Email and password are required.' });
  }
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err || !user) return res.render('login', { error: 'Invalid email or password.' });
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.render('login', { error: 'Invalid email or password.' });
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    return res.redirect(user.role === 'client' ? '/client/dashboard' : '/user/dashboard');
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// --------------- Owner (client) routes ---------------

app.get('/client/dashboard', requireAuth, requireRole('client'), (req, res) => {
  const ownerId = req.session.user.id;

  const spacesSql = 'SELECT * FROM parking_spaces WHERE owner_id = ? ORDER BY created_at DESC';
  const statsSql = `
    SELECT
      COALESCE(SUM(b.owner_earnings), 0) as total_earnings,
      COUNT(b.id) as total_bookings,
      COALESCE(SUM(CASE WHEN b.booking_status = 'Active' THEN b.owner_earnings ELSE 0 END), 0) as pending_payout,
      COALESCE(SUM(CASE WHEN b.booking_status = 'Completed' THEN b.owner_earnings ELSE 0 END), 0) as completed_payout,
      COALESCE(SUM(CASE WHEN DATE(b.created_at) = DATE('now') THEN b.owner_earnings ELSE 0 END), 0) as today_earnings
    FROM bookings b
    JOIN parking_spaces ps ON b.parking_space_id = ps.id
    WHERE ps.owner_id = ? AND b.booking_status != 'Cancelled'
  `;
  const bookingsSql = `
    SELECT
      b.*,
      ps.title as parking_name,
      u.name as user_name
    FROM bookings b
    JOIN parking_spaces ps ON b.parking_space_id = ps.id
    JOIN users u ON b.user_id = u.id
    WHERE ps.owner_id = ?
    ORDER BY b.created_at DESC
    LIMIT 50
  `;
  const monthlySql = `
    SELECT
      strftime('%Y-%m', b.created_at) as month,
      COALESCE(SUM(b.owner_earnings), 0) as earnings
    FROM bookings b
    JOIN parking_spaces ps ON b.parking_space_id = ps.id
    WHERE ps.owner_id = ? AND b.booking_status != 'Cancelled'
    GROUP BY month
    ORDER BY month ASC
    LIMIT 12
  `;

  db.all(spacesSql, [ownerId], (err, spaces) => {
    if (err) return res.status(500).send('Error loading parking spaces.');

    db.get(statsSql, [ownerId], (err2, stats) => {
      if (err2) stats = { total_earnings: 0, total_bookings: 0, pending_payout: 0, completed_payout: 0, today_earnings: 0 };

      db.all(bookingsSql, [ownerId], (err3, bookings) => {
        if (err3) bookings = [];

        db.all(monthlySql, [ownerId], (err4, monthlyData) => {
          if (err4) monthlyData = [];

          res.render('client_dashboard', {
            spaces,
            stats: stats || { total_earnings: 0, total_bookings: 0, pending_payout: 0, completed_payout: 0, today_earnings: 0 },
            bookings,
            monthlyData,
            commissionRate: COMMISSION_RATE,
          });
        });
      });
    });
  });
});

app.get('/client/bookings/export', requireAuth, requireRole('client'), (req, res) => {
  const ownerId = req.session.user.id;
  const sql = `
    SELECT
      b.id as booking_id,
      u.name as user_name,
      ps.title as parking_name,
      b.booking_date,
      b.start_time,
      b.end_time,
      b.total_amount,
      b.platform_commission,
      b.owner_earnings,
      b.payment_status,
      b.booking_status,
      b.created_at
    FROM bookings b
    JOIN parking_spaces ps ON b.parking_space_id = ps.id
    JOIN users u ON b.user_id = u.id
    WHERE ps.owner_id = ?
    ORDER BY b.created_at DESC
  `;
  db.all(sql, [ownerId], (err, rows) => {
    if (err) return res.status(500).send('Export error.');
    const header = 'Booking ID,User,Parking,Date,Start,End,Total,Commission,Owner Earnings,Payment,Status,Created\n';
    const csvRows = rows.map((r) =>
      [r.booking_id, `"${r.user_name}"`, `"${r.parking_name}"`, r.booking_date, r.start_time, r.end_time, r.total_amount, r.platform_commission, r.owner_earnings, r.payment_status, r.booking_status, r.created_at].join(',')
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=bookings-export.csv');
    res.send(header + csvRows.join('\n'));
  });
});

app.get('/client/parking/new', requireAuth, requireRole('client'), (req, res) => {
  res.render('parking_new', { error: null });
});

app.post('/client/parking/new', requireAuth, requireRole('client'), (req, res) => {
  const { title, address, location_description, vehicle_type, total_slots, available_from, available_to, price_per_hour } = req.body;
  if (!title || !address || !location_description || !vehicle_type || !total_slots || !available_from || !available_to || !price_per_hour) {
    return res.render('parking_new', { error: 'All fields are required.' });
  }
  const stmt = db.prepare(
    `INSERT INTO parking_spaces
    (owner_id, title, address, location_description, vehicle_type, total_slots, available_from, available_to, price_per_hour)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(req.session.user.id, title, address, location_description, vehicle_type, Number(total_slots), available_from, available_to, Number(price_per_hour), (err) => {
    if (err) return res.render('parking_new', { error: 'Could not save parking space. Try again.' });
    res.redirect('/client/dashboard');
  });
});

// --------------- User routes ---------------

app.get('/user/dashboard', requireAuth, requireRole('user'), (req, res) => {
  db.all(
    'SELECT ps.*, u.name as owner_name FROM parking_spaces ps JOIN users u ON ps.owner_id = u.id ORDER BY ps.created_at DESC',
    [],
    (err, spaces) => {
      if (err) return res.status(500).send('Error loading parking spaces.');
      res.render('user_dashboard', {
        spaces,
        query: { location: '', vehicle_type: '', sort: 'distance' },
        nearbyCount: null,
        hasUserLocation: false,
      });
    }
  );
});

app.get('/user/search', requireAuth, requireRole('user'), (req, res) => {
  const { location, vehicle_type, user_lat, user_lng, sort } = req.query;

  const hasCoords =
    user_lat && user_lng && !Number.isNaN(Number(user_lat)) && !Number.isNaN(Number(user_lng));

  let sql =
    'SELECT ps.*, u.name as owner_name FROM parking_spaces ps JOIN users u ON ps.owner_id = u.id WHERE 1=1';
  const params = [];

  // When we have GPS coordinates, skip text-based location filtering
  // so all spaces are returned and sorted by real distance instead
  if (location && !hasCoords) {
    sql += ' AND (ps.address LIKE ? OR ps.location_description LIKE ?)';
    params.push(`%${location}%`, `%${location}%`);
  }

  if (vehicle_type) {
    sql += ' AND (ps.vehicle_type = ? OR ps.vehicle_type = ?)';
    params.push(vehicle_type, 'both');
  }

  db.all(sql, params, (err, spaces) => {
    if (err) return res.status(500).send('Error searching parking spaces.');

    let nearbyCount = null;

    if (hasCoords) {
      attachDistances(spaces, Number(user_lat), Number(user_lng));
      nearbyCount = spaces.filter(
        (s) => typeof s.distance_km === 'number' && s.distance_km <= 10
      ).length;
    }

    sortSpaces(spaces, sort || 'distance');

    res.render('user_dashboard', {
      spaces,
      query: {
        location: location || '',
        vehicle_type: vehicle_type || '',
        sort: sort || 'distance',
      },
      nearbyCount,
      hasUserLocation: !!hasCoords,
    });
  });
});

app.get('/user/book/:id', requireAuth, requireRole('user'), (req, res) => {
  db.get(
    'SELECT ps.*, u.name as owner_name, u.email as owner_email FROM parking_spaces ps JOIN users u ON ps.owner_id = u.id WHERE ps.id = ?',
    [req.params.id],
    (err, space) => {
      if (err || !space) return res.status(404).send('Parking space not found.');
      res.render('booking_new', { space, error: null, commissionRate: COMMISSION_RATE });
    }
  );
});

app.post('/user/book/:id', requireAuth, requireRole('user'), (req, res) => {
  const id = req.params.id;
  const { start_time, end_time } = req.body;

  if (!start_time || !end_time) {
    return db.get(
      'SELECT ps.*, u.name as owner_name, u.email as owner_email FROM parking_spaces ps JOIN users u ON ps.owner_id = u.id WHERE ps.id = ?',
      [id],
      (err, space) => {
        if (err || !space) return res.status(404).send('Parking space not found.');
        res.render('booking_new', { space, error: 'Please enter start and end time.', commissionRate: COMMISSION_RATE });
      }
    );
  }

  db.get(
    'SELECT ps.*, u.name as owner_name FROM parking_spaces ps JOIN users u ON ps.owner_id = u.id WHERE ps.id = ?',
    [id],
    (err, space) => {
      if (err || !space) return res.status(404).send('Parking space not found.');

      const start = new Date(start_time);
      const end = new Date(end_time);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
        return res.status(400).send('Invalid start or end time.');
      }

      const hours = Math.ceil((end - start) / (1000 * 60 * 60));
      const totalAmount = hours * space.price_per_hour;
      const platformCommission = Math.round(totalAmount * COMMISSION_RATE * 100) / 100;
      const ownerEarnings = Math.round((totalAmount - platformCommission) * 100) / 100;
      const bookingDate = start.toISOString().slice(0, 10);

      const stmt = db.prepare(
        `INSERT INTO bookings (
          user_id, parking_space_id, parking_id, vehicle_type, booking_date,
          start_time, end_time, total_price, total_amount,
          platform_commission, owner_earnings,
          payment_status, booking_status,
          refund_amount, refund_status, refund_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      stmt.run(
        req.session.user.id, space.id, space.id, space.vehicle_type, bookingDate,
        start.toISOString(), end.toISOString(), totalAmount, totalAmount,
        platformCommission, ownerEarnings,
        'Paid', 'Active', null, null, null,
        function (err2) {
          if (err2) return res.status(500).send('Could not create booking. Please try again.');

          // Credit owner's pending payout
          db.run(
            `UPDATE users SET
              pending_payout = COALESCE(pending_payout, 0) + ?,
              total_earnings = COALESCE(total_earnings, 0) + ?,
              total_bookings = COALESCE(total_bookings, 0) + 1
            WHERE id = ?`,
            [ownerEarnings, ownerEarnings, space.owner_id]
          );

          const bookingId = this.lastID;
          const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(space.address)}`;

          res.render('booking_confirm', {
            booking: {
              id: bookingId,
              start_time: start.toLocaleString(),
              end_time: end.toLocaleString(),
              total_price: totalAmount.toFixed(2),
              platform_commission: platformCommission.toFixed(2),
              owner_earnings: ownerEarnings.toFixed(2),
            },
            space,
            mapsUrl,
          });
        }
      );
    }
  );
});

app.get('/user/bookings', requireAuth, requireRole('user'), (req, res) => {
  const statusFilter = req.query.status || 'all';
  const params = [req.session.user.id];
  let whereStatus = '';
  if (['Active', 'Completed', 'Cancelled'].includes(statusFilter)) {
    whereStatus = ' AND b.booking_status = ?';
    params.push(statusFilter);
  }

  db.all(
    `SELECT b.*, ps.title as parking_name, ps.address as parking_address, ps.vehicle_type as space_vehicle_type
     FROM bookings b
     JOIN parking_spaces ps ON b.parking_space_id = ps.id
     WHERE b.user_id = ?${whereStatus}
     ORDER BY b.created_at DESC`,
    params,
    (err, bookings) => {
      if (err) return res.status(500).send('Error loading bookings.');
      res.render('my_bookings', { bookings, statusFilter });
    }
  );
});

app.post('/user/bookings/:id/cancel', requireAuth, requireRole('user'), (req, res) => {
  const bookingId = req.params.id;

  db.get(
    `SELECT b.*, ps.title as parking_name, ps.address as parking_address,
            ps.total_slots, ps.available_slots, ps.owner_id
     FROM bookings b
     JOIN parking_spaces ps ON b.parking_space_id = ps.id
     WHERE b.id = ? AND b.user_id = ?`,
    [bookingId, req.session.user.id],
    (err, booking) => {
      if (err || !booking) return res.status(404).send('Booking not found.');
      if (booking.booking_status && booking.booking_status !== 'Active') {
        return res.status(400).send('This booking cannot be cancelled.');
      }

      const now = new Date();
      const start = new Date(booking.start_time);
      if (isNaN(start.getTime())) return res.status(400).send('Invalid booking start time.');
      if (now >= start) return res.status(400).send('Cannot cancel after start time.');

      const hoursBeforeStart = (start - now) / (1000 * 60 * 60);
      const baseAmount = booking.total_amount || booking.total_price || 0;
      let refundAmount = 0;
      if (hoursBeforeStart > 2) refundAmount = baseAmount;
      else if (hoursBeforeStart > 0) refundAmount = baseAmount * 0.5;

      const refundDate = new Date().toISOString();
      const paymentStatus = refundAmount > 0 ? 'Refunded' : booking.payment_status || 'Paid';
      const ownerEarnings = booking.owner_earnings || 0;

      db.run(
        `UPDATE bookings SET booking_status = 'Cancelled', refund_amount = ?, refund_status = 'Processed', refund_date = ?, payment_status = ? WHERE id = ?`,
        [refundAmount, refundDate, paymentStatus, bookingId],
        (err2) => {
          if (err2) return res.status(500).send('Error cancelling booking.');

          db.run(
            `UPDATE parking_spaces SET available_slots = MIN(total_slots, COALESCE(available_slots, total_slots) + 1) WHERE id = ?`,
            [booking.parking_space_id]
          );

          // Reverse owner's pending payout
          db.run(
            `UPDATE users SET
              pending_payout = MAX(0, COALESCE(pending_payout, 0) - ?),
              total_earnings = MAX(0, COALESCE(total_earnings, 0) - ?)
            WHERE id = ?`,
            [ownerEarnings, ownerEarnings, booking.owner_id]
          );

          res.redirect('/user/bookings?status=Cancelled');
        }
      );
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
