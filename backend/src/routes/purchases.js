const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { auth } = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  const { year, supplierId, projectId } = req.query;
  const where = {};
  if (year) where.year = parseInt(year);
  if (supplierId) where.supplierId = supplierId;
  if (projectId) where.projectId = projectId;
  const purchases = await prisma.purchase.findMany({
    where, include: { supplier: { select: { name: true } }, project: { select: { code: true, name: true } } },
    orderBy: { date: 'desc' }
  });
  res.json(purchases);
});

router.post('/', auth, async (req, res) => {
  const purchase = await prisma.purchase.create({
    data: { ...req.body, date: new Date(req.body.date), year: new Date(req.body.date).getFullYear() }
  });
  res.status(201).json(purchase);
});

module.exports = router;
