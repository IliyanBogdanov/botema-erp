require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = require('../src/lib/prisma');
const { generateAlerts } = require('../src/lib/alertEngine');

generateAlerts(prisma)
  .then(alerts => {
    console.log('Alerts generated:', Array.isArray(alerts) ? alerts.length : alerts);
    if (Array.isArray(alerts)) {
      alerts.slice(0, 10).forEach(alert => console.log(`- [${alert.severity}] ${alert.title}`));
    }
    process.exit(0);
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
