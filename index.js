import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pkg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import http from 'http';
import { Server } from 'socket.io';

dotenv.config();

const { Pool } = pkg;
const app = express();
const port = process.env.PORT || 5000;

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// ─── DB Pool ──────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('connect', () => console.log('✅ Connected to Neon PostgreSQL'));
pool.on('error', (err) => { console.error('DB error', err); process.exit(-1); });

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Auth Middleware ───────────────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ─── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Logistiqo API is running' });
});

// ─── Admin Auth ────────────────────────────────────────────────────────────────
// Seed admin (run once)
app.post('/api/admin/seed', async (req, res) => {
  try {
    const { username, password, secret } = req.body;
    if (secret !== process.env.SEED_SECRET) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO admins (username, password_hash) VALUES ($1, $2) ON CONFLICT (username) DO UPDATE SET password_hash=$2',
      [username, hash]
    );
    res.json({ message: 'Admin seeded successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }
    const result = await pool.query('SELECT * FROM admins WHERE username=$1', [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const admin = result.rows[0];
    const valid = await bcrypt.compare(password, admin.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: admin.id, username: admin.username },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, admin: { id: admin.id, username: admin.username } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Shipments (Admin) ────────────────────────────────────────────────────────
// Create shipment
app.post('/api/shipments', authMiddleware, async (req, res) => {
  try {
    const {
      tracking_number, sender_name, sender_address,
      receiver_name, receiver_address, start_location, end_location,
      start_lat, start_lng, end_lat, end_lng, total_hours,
      weight, description, package_type
    } = req.body;

    if (!tracking_number || !start_location || !end_location || !total_hours || !start_lat || !start_lng || !end_lat || !end_lng) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const expected_delivery = new Date(Date.now() + total_hours * 3600 * 1000);

    const result = await pool.query(
      `INSERT INTO shipments 
        (tracking_number, sender_name, sender_address, receiver_name, receiver_address,
         start_location, end_location, start_lat, start_lng, end_lat, end_lng,
         total_hours, weight, description, package_type, status, started_at, expected_delivery)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'In Transit',NOW(),$16)
       RETURNING *`,
      [tracking_number, sender_name, sender_address, receiver_name, receiver_address,
       start_location, end_location, start_lat, start_lng, end_lat, end_lng,
       total_hours, weight, description, package_type, expected_delivery]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    if (err.code === '23505') return res.status(409).json({ error: 'Tracking number already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all shipments (Admin)
app.get('/api/shipments', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM shipments ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update shipment (Admin)
app.put('/api/shipments/:tracking_number', authMiddleware, async (req, res) => {
  try {
    const { tracking_number } = req.params;
    const { is_paused, elapsed_hours, status } = req.body;

    const currentRes = await pool.query('SELECT * FROM shipments WHERE tracking_number=$1', [tracking_number]);
    if (currentRes.rows.length === 0) return res.status(404).json({ error: 'Shipment not found' });
    const s = currentRes.rows[0];

    let query = 'UPDATE shipments SET updated_at=NOW()';
    const params = [];
    let i = 1;

    if (is_paused !== undefined) {
      query += `, is_paused=$${i++}`;
      params.push(is_paused);
      
      if (is_paused && !s.is_paused) {
        // Pausing
        query += `, pause_started_at=NOW()`;
      } else if (!is_paused && s.is_paused && s.pause_started_at) {
        // Resuming
        query += `, started_at = started_at + (NOW() - pause_started_at)`;
        query += `, expected_delivery = expected_delivery + (NOW() - pause_started_at)`;
        query += `, pause_started_at = NULL`;
      }
    }
    
    if (elapsed_hours !== undefined) {
      query += `, elapsed_hours=$${i++}`;
      params.push(elapsed_hours);
    }
    if (status !== undefined) {
      query += `, status=$${i++}`;
      params.push(status);
    }

    query += ` WHERE tracking_number=$${i} RETURNING *`;
    params.push(tracking_number);

    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete shipment (Admin)
app.delete('/api/shipments/:tracking_number', authMiddleware, async (req, res) => {
  try {
    const { tracking_number } = req.params;
    await pool.query('DELETE FROM shipments WHERE tracking_number=$1', [tracking_number]);
    res.json({ message: 'Shipment deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Public Tracking ───────────────────────────────────────────────────────────
app.get('/api/track/:tracking_number', async (req, res) => {
  try {
    const { tracking_number } = req.params;
    const result = await pool.query(
      'SELECT * FROM shipments WHERE tracking_number=$1',
      [tracking_number.toUpperCase()]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tracking number not found' });
    }
    const s = result.rows[0];

    // Compute current position by interpolating based on elapsed time
    const now = Date.now();
    const startedAt = new Date(s.started_at).getTime();
    const totalMs = parseFloat(s.total_hours) * 3600 * 1000;
    const elapsedMs = s.is_paused
      ? parseFloat(s.elapsed_hours) * 3600 * 1000
      : Math.min(now - startedAt, totalMs);

    let progress = Math.min(elapsedMs / totalMs, 1);
    if (s.status === 'Delivered') progress = 1;

    const currentLat = parseFloat(s.start_lat) + (parseFloat(s.end_lat) - parseFloat(s.start_lat)) * progress;
    const currentLng = parseFloat(s.start_lng) + (parseFloat(s.end_lng) - parseFloat(s.start_lng)) * progress;

    res.json({
      tracking_number: s.tracking_number,
      sender_name: s.sender_name,
      sender_address: s.sender_address,
      receiver_name: s.receiver_name,
      receiver_address: s.receiver_address,
      start_location: s.start_location,
      end_location: s.end_location,
      weight: s.weight,
      package_type: s.package_type,
      description: s.description,
      status: s.status,
      is_moving: !s.is_paused && s.status === 'In Transit',
      progress: Math.round(progress * 100),
      current_lat: currentLat,
      current_lng: currentLng,
      start_lat: parseFloat(s.start_lat),
      start_lng: parseFloat(s.start_lng),
      end_lat: parseFloat(s.end_lat),
      end_lng: parseFloat(s.end_lng),
      expected_delivery: s.expected_delivery,
      started_at: s.started_at,
      created_at: s.created_at,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Contact ───────────────────────────────────────────────────────────────────
app.post('/api/contact', async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Name, email, and message are required' });
    }
    await pool.query(
      'INSERT INTO contact_messages (name, email, phone, subject, message) VALUES ($1,$2,$3,$4,$5)',
      [name, email, phone, subject, message]
    );
    res.json({ message: 'Message received. We will be in touch shortly.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all contact messages (Admin)
app.get('/api/contact', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM contact_messages ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all chat sessions (Admin)
app.get('/api/chats', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query('SELECT tracking_number, MAX(created_at) as last_msg FROM chat_messages GROUP BY tracking_number ORDER BY last_msg DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);

  socket.on('join_chat', async ({ tracking_number, isAdmin }) => {
    try {
      if (!isAdmin) {
        // Verify tracking number exists
        const result = await pool.query('SELECT id FROM shipments WHERE tracking_number ILIKE $1', [tracking_number]);
        if (result.rows.length === 0) {
          return socket.emit('chat_error', { message: 'Invalid tracking number' });
        }
      }
      
      socket.join(tracking_number);
      console.log(`User joined chat for tracking number: ${tracking_number}`);

      // Fetch chat history
      const history = await pool.query('SELECT * FROM chat_messages WHERE tracking_number=$1 ORDER BY created_at ASC', [tracking_number]);
      socket.emit('chat_history', history.rows);
    } catch (err) {
      console.error(err);
      socket.emit('chat_error', { message: 'An internal error occurred. Please try again.' });
    }
  });

  socket.on('send_message', async ({ tracking_number, sender, message }) => {
    try {
      const result = await pool.query(
        'INSERT INTO chat_messages (tracking_number, sender, message) VALUES ($1, $2, $3) RETURNING *',
        [tracking_number, sender, message]
      );
      io.to(tracking_number).emit('receive_message', result.rows[0]);
    } catch (err) {
      console.error(err);
    }
  });

  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// ─── Start Server ──────────────────────────────────────────────────────────────
server.listen(port, () => {
  console.log(`🚀 Logistiqo API running on port ${port}`);
});
