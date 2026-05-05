const { PrismaClient } = require('@prisma/client');

const prisma = global.__botemaPrisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__botemaPrisma = prisma;
}

module.exports = prisma;
