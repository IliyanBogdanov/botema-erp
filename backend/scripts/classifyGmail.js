const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const pending = await prisma.$queryRaw`
    SELECT id, "from", subject, "hasAttachments" FROM gmail_messages
    WHERE status = 'PENDING'::"GmailMessageStatus"
    ORDER BY date DESC
  `;
  console.log('Pending:', pending.length);

  const IGNORE_SENDERS = ['railway.app', 'openai.com', 'supabase.io', 'ozone.bg', 'raben', 'speedy.bg', 'allianz', 'freelancer.com'];
  const IGNORE_SUBS   = ['build failed', 'security vulnerabilities', 'застрахователно', 'new arrivals', 'reduced prices', '***spam***'];

  let ignored=0, invoiceIn=0, bank=0, offer=0, delivery=0;

  for (const msg of pending) {
    const f = (msg.from||'').toLowerCase();
    const s = (msg.subject||'').toLowerCase();

    let status, type;
    if (IGNORE_SENDERS.some(x=>f.includes(x)) || IGNORE_SUBS.some(x=>s.includes(x))) {
      status='IGNORED'; type=null; ignored++;
    } else if (s.includes('invoice number')||s.includes('фактура м')||s.includes('ф-ра м')||f.includes('lodes')||f.includes('dhl.com')||f.includes('polaris')||s.includes('dhl фактура')||s.includes('last dhl')) {
      status='CLASSIFIED'; type='INVOICE_IN'; invoiceIn++;
    } else if (f.includes('teximbank')||s.includes('bank account statement')||s.includes('банково извлечение')) {
      status='CLASSIFIED'; type='BANK_STATEMENT'; bank++;
    } else if (s.includes('оферта')&&msg.hasAttachments) {
      status='CLASSIFIED'; type='OFFER_OUT'; offer++;
    } else if (s.includes('delivery note')||f.includes('dachser')||f.includes('fercam')) {
      status='CLASSIFIED'; type='DELIVERY_NOTE'; delivery++;
    } else {
      continue;
    }

    await prisma.$executeRaw`
      UPDATE gmail_messages SET status=${status}::"GmailMessageStatus", "classifiedType"=${type}, "updatedAt"=now()
      WHERE id=${msg.id}
    `;
  }

  console.log('Result:', {ignored, invoiceIn, bankStatement:bank, offer, delivery});
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
