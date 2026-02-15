const express = require('express');
const path = require('path');
const mysql = require('mysql2/promise');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ziad1234';
const ADMIN_PATH = process.env.ADMIN_PATH || 'admin-mentors-2026';
const COPYRIGHT_NOTICE = '-@copyright directed by Ziad ElKhouly-';

// MySQL connection via env vars
const {
  MYSQL_HOST = 'localhost',
  MYSQL_PORT = 3306,
  MYSQL_USER = 'root',
  MYSQL_PASSWORD = '',
  MYSQL_DATABASE = 'mentorsdb'
} = process.env;

let pool;

async function initDb() {
  pool = mysql.createPool({
    host: MYSQL_HOST,
    port: Number(MYSQL_PORT),
    user: MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  // Ensure tables exist and seed developers
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS developers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL
      );
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS availability (
        id INT AUTO_INCREMENT PRIMARY KEY,
        destination VARCHAR(255) NOT NULL,
        property_type VARCHAR(255) NOT NULL,
        budget DECIMAL(18,2) NOT NULL,
        delivery VARCHAR(255) NOT NULL,
        developer VARCHAR(255) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        password VARCHAR(255),
        destination VARCHAR(255),
        property_type VARCHAR(255),
        developer VARCHAR(255),
        budget DECIMAL(18,2),
        delivery VARCHAR(255),
        looking_for VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const [rows] = await conn.query('SELECT COUNT(*) AS c FROM developers');
    if (rows[0].c === 0) {
      await conn.query(
        `INSERT IGNORE INTO developers (name) VALUES
        ('Sodic'), ('Hassan Allam'), ('Ora'), ('Orascom'),
        ('Madinet Masr'), ('Hyde Park'), ('Tatweer Misr')`
      );
    }
  } finally {
    conn.release();
  }
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-App-Copyright', COPYRIGHT_NOTICE);
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

function isValidPhone(phone) {
  if (!/^\d{11}$/.test(phone)) return false;
  return /^(010|011|012|015)\d{8}$/.test(phone);
}

function normalizeBudget(input) {
  const raw = String(input || '').replace(/,/g, '').trim();
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return value;
}

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || token !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/filter', (req, res) => res.sendFile(path.join(__dirname, 'filter.html')));
app.get('/admin', (req, res) => res.status(404).send('Not Found'));
app.get(`/${ADMIN_PATH}`, (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) return res.json({ ok: true });
  return res.status(401).json({ error: 'Wrong password.' });
});

// Auth
app.post('/api/signup', async (req, res) => {
  const { username, password, phone, email } = req.body;
  if (!username || !password || !phone || !email) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Invalid phone number.' });
  }
  const conn = await pool.getConnection();
  try {
    const [existing] = await conn.query(
      'SELECT id FROM users WHERE LOWER(username)=LOWER(?) LIMIT 1',
      [username]
    );
    if (existing.length) {
      return res.status(409).json({ error: 'Username already exists.' });
    }
    const [result] = await conn.query(
      'INSERT INTO users (username, password, phone, email) VALUES (?, ?, ?, ?)',
      [username, password, phone, email]
    );
    res.json({ ok: true, user: { id: result.insertId, username, email, phone } });
  } finally {
    conn.release();
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      'SELECT username, email, phone FROM users WHERE LOWER(username)=LOWER(?) AND password=? LIMIT 1',
      [username, password]
    );
    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    res.json({ ok: true, user: rows[0] });
  } finally {
    conn.release();
  }
});

// Users (admin)
app.get('/api/users', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      'SELECT id, username, phone, email, password, created_at AS createdAt FROM users ORDER BY created_at DESC'
    );
    res.json({ ok: true, users: rows });
  } finally {
    conn.release();
  }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ ok: true });
  } finally {
    conn.release();
  }
});

// Developers
app.get('/api/developers', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT id, name FROM developers ORDER BY id DESC');
    res.json({ ok: true, developers: rows });
  } finally {
    conn.release();
  }
});

app.post('/api/developers', requireAdmin, async (req, res) => {
  const { name } = req.body;
  const trimmed = String(name || '').trim();
  if (!trimmed) return res.status(400).json({ error: 'Developer name is required.' });
  const conn = await pool.getConnection();
  try {
    await conn.query('INSERT INTO developers (name) VALUES (?)', [trimmed]);
    const [rows] = await conn.query('SELECT id, name FROM developers WHERE name = ?', [trimmed]);
    res.json({ ok: true, developer: rows[0] });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Developer already exists.' });
    }
    throw err;
  } finally {
    conn.release();
  }
});

app.delete('/api/developers/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.query('DELETE FROM developers WHERE id = ?', [id]);
    res.json({ ok: true });
  } finally {
    conn.release();
  }
});

// Availability
app.get('/api/availability', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      'SELECT id, destination, property_type, budget, delivery, developer, COALESCE(notes, "") AS notes, created_at FROM availability ORDER BY created_at DESC'
    );
    const items = rows.map((r) => ({
      id: r.id,
      destination: r.destination,
      propertyType: r.property_type,
      budget: Number(r.budget).toLocaleString('en-US'),
      delivery: r.delivery,
      developer: r.developer,
      notes: r.notes,
      createdAt: r.created_at
    }));
    res.json({ ok: true, items });
  } finally {
    conn.release();
  }
});

app.post('/api/availability', requireAdmin, async (req, res) => {
  const { destination, propertyType, budget, delivery, developer, notes } = req.body;
  if (!destination || !propertyType || !budget || !delivery || !developer) {
    return res
      .status(400)
      .json({ error: 'Destination, property type, developer, budget, and delivery are required.' });
  }
  const budgetValue = normalizeBudget(budget);
  if (!budgetValue || budgetValue < 0) {
    return res.status(400).json({ error: 'Budget must be a positive number.' });
  }
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query(
      `INSERT INTO availability (destination, property_type, budget, delivery, developer, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [destination, propertyType, budgetValue, delivery, developer, notes || '']
    );
    const [rows] = await conn.query(
      'SELECT id, destination, property_type, budget, delivery, developer, COALESCE(notes,"") AS notes FROM availability WHERE id = ?',
      [result.insertId]
    );
    const item = rows[0];
    res.json({
      ok: true,
      item: {
        id: item.id,
        destination: item.destination,
        propertyType: item.property_type,
        budget: Number(item.budget).toLocaleString('en-US'),
        delivery: item.delivery,
        developer: item.developer,
        notes: item.notes
      }
    });
  } finally {
    conn.release();
  }
});

app.put('/api/availability/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { destination, propertyType, budget, delivery, developer, notes } = req.body;
  const budgetValue = normalizeBudget(budget);
  if (!budgetValue || budgetValue < 0) {
    return res.status(400).json({ error: 'Budget must be a positive number.' });
  }
  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query(
      `UPDATE availability
       SET destination = ?, property_type = ?, budget = ?, delivery = ?, developer = ?, notes = ?
       WHERE id = ?`,
      [destination, propertyType, budgetValue, delivery, developer, notes || '', id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Availability not found.' });
    }
    const [rows] = await conn.query(
      'SELECT id, destination, property_type, budget, delivery, developer, COALESCE(notes,"") AS notes FROM availability WHERE id = ?',
      [id]
    );
    const item = rows[0];
    res.json({
      ok: true,
      item: {
        id: item.id,
        destination: item.destination,
        propertyType: item.property_type,
        budget: Number(item.budget).toLocaleString('en-US'),
        delivery: item.delivery,
        developer: item.developer,
        notes: item.notes
      }
    });
  } finally {
    conn.release();
  }
});

app.delete('/api/availability/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.query('DELETE FROM availability WHERE id = ?', [id]);
    res.json({ ok: true });
  } finally {
    conn.release();
  }
});

// Leads / requests
app.post('/api/requests', async (req, res) => {
  const {
    username,
    email,
    phone,
    password,
    destination,
    propertyType,
    developer,
    budget,
    delivery,
    lookingFor
  } = req.body;

  if (!username || !email || !phone) {
    return res.status(400).json({ error: 'Missing user info.' });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Invalid phone number.' });
  }
  const budgetValue = normalizeBudget(budget);
  if (!budgetValue || budgetValue < 1000000 || budgetValue > 1000000000) {
    return res.status(400).json({ error: 'Budget must be between 1,000,000 and 1,000,000,000.' });
  }

  const conn = await pool.getConnection();
  try {
    const [result] = await conn.query(
      `INSERT INTO leads (username, email, phone, password, destination, property_type, developer, budget, delivery, looking_for)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username,
        email,
        phone,
        password || '',
        destination,
        propertyType,
        developer || '',
        budgetValue,
        delivery,
        lookingFor
      ]
    );
    const [rows] = await conn.query(
      `SELECT id, username, email, phone, password, destination, property_type, developer, budget, delivery, looking_for, created_at AS createdAt
       FROM leads WHERE id = ?`,
      [result.insertId]
    );
    const lead = rows[0];
    res.json({
      ok: true,
      lead: {
        id: lead.id,
        username: lead.username,
        email: lead.email,
        phone: lead.phone,
        password: lead.password,
        destination: lead.destination,
        propertyType: lead.property_type,
        developer: lead.developer,
        budget: Number(lead.budget).toLocaleString('en-US'),
        delivery: lead.delivery,
        lookingFor: lead.looking_for,
        createdAt: lead.createdAt
      }
    });
  } finally {
    conn.release();
  }
});

app.get('/api/leads', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query(
      `SELECT id, username, email, phone, password, destination, property_type, developer, budget, delivery, looking_for, created_at AS createdAt
       FROM leads
       ORDER BY created_at DESC`
    );
    const leads = rows.map((lead) => ({
      id: lead.id,
      username: lead.username,
      email: lead.email,
      phone: lead.phone,
      password: lead.password,
      destination: lead.destination,
      propertyType: lead.property_type,
      developer: lead.developer,
      budget: Number(lead.budget).toLocaleString('en-US'),
      delivery: lead.delivery,
      lookingFor: lead.looking_for,
      createdAt: lead.createdAt
    }));
    res.json({ ok: true, leads });
  } finally {
    conn.release();
  }
});

app.delete('/api/leads/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.query('DELETE FROM leads WHERE id = ?', [id]);
    res.json({ ok: true });
  } finally {
    conn.release();
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log('-----------------------------------------');
      console.log(`Mentors Real Estate app running on http://localhost:${PORT}`);
      console.log(`Admin page: http://localhost:${PORT}/${ADMIN_PATH}`);
      console.log('-----------------------------------------');
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
