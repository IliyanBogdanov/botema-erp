const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !await bcrypt.compare(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/register (admin only - first user)
router.post('/register', async (req, res) => {
  try {
    const count = await prisma.user.count();
    if (count > 0) return res.status(403).json({ error: 'Registration closed' });
    const { email, password, name } = req.body;
    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({ data: { email, name, password: hashed, role: 'ADMIN' } });
    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').auth, (req, res) => {
  res.json({ id: req.user.id, email: req.user.email, name: req.user.name, role: req.user.role });
});

// POST /api/auth/reset-admin — one-time admin password reset (requires ADMIN_PASSWORD env)
router.post('/reset-admin', async (req, res) => {
  try {
    const { secret, newPassword } = req.body;
    if (!secret || secret !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'newPassword required (min 8 chars)' });
    }
    const hashed = await bcrypt.hash(newPassword, 12);
    const user = await prisma.user.update({
      where: { email: 'office@studiobotema.com' },
      data: { password: hashed },
    });
    res.json({ ok: true, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
