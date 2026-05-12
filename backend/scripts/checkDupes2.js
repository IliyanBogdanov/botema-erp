const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const dupPay = await p.$queryRawUnsafe(
    `SELECT reference, "paymentDate", amount, COUNT(*) as cnt FROM payments WHERE reference IS NOT NULL GROUP BY reference, "paymentDate", amount HAVING COUNT(*) > 1 ORDER BY cnt DESC LIMIT 10`
  );
  console.log('Payment duplicates by ref+date+amount:', dupPay.length ? dupPay : 'None found');
  
  // Also check gmail_messages for dupes
  const dupGmail = await p.$queryRawUnsafe(
    `SELECT "gmailId", COUNT(*) as cnt FROM gmail_messages WHERE "gmailId" IS NOT NULL GROUP BY "gmailId" HAVING COUNT(*) > 1 LIMIT 10`
  );
  console.log('Gmail message duplicates:', dupGmail.length ? dupGmail : 'None found');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
