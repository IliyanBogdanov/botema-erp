const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const { status, year } = req.query;
  const where = {};
  if (status) where.status = status;
  if (year) where.year = parseInt(year);
  const projects = await prisma.project.findMany({
    where, include: { client: { select: { id: true, name: true } },
      invoices: { select: { amountNet: true, status: true } },
      purchases: { select: { amount: true } }
    }, orderBy: { year: 'desc' }
  });
  const enriched = projects.map(p => ({
    ...p,
    totalRevenue: p.invoices.filter(i => i.status !== 'CANCELLED').reduce((s, i) => s + Number(i.amountNet), 0),
    totalCosts: p.purchases.reduce((s, i) => s + Number(i.amount), 0),
  }));
  res.json(enriched);
});

router.post('/', auth, async (req, res) => {
  const project = await prisma.project.create({ data: { ...req.body, year: req.body.year || new Date().getFullYear() } });
  res.status(201).json(project);
});

router.patch('/:id', auth, async (req, res) => {
  const project = await prisma.project.update({ where: { id: req.params.id }, data: req.body });
  res.json(project);
});

router.get('/:id', auth, async (req, res) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id },
    include: {
      client: true,
      invoices: { include: { client: { select: { name: true } } } },
      purchases: { include: { supplier: { select: { name: true } } } },
      inventory: { include: { supplier: { select: { name: true } } } }
    }
  });
  res.json(project);
});

module.exports = router;
