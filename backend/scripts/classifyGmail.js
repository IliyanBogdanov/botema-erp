const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const pending = await prisma.$queryRaw`
    SELECT id, "from", subject, "hasAttachments" FROM gmail_messages
    WHERE status = 'PENDING'::"GmailMessageStatus"
    ORDER BY date DESC
  `;
  console.log('Pending:', pending.length);

  const IGNORE_SENDERS = [
    'railway.app', 'openai.com', 'supabase.io', 'ozone.bg', 'raben', 'speedy.bg',
    'allianz', 'freelancer.com', 'anthropic', 'stripe.com', 'ikea.bg',
  ];
  const IGNORE_SUBS = [
    'build failed', 'security vulnerabilities', 'застрахователно',
    'new arrivals', 'reduced prices', '***spam***', 'unsubscribe',
    'no longer available', 'newsletter',
  ];

  // Suppliers that send invoices
  const INVOICE_IN_SENDERS = [
    'lodes', 'dhl.com', 'polaris', 'teximbank', 'alphaluce', 'acalight',
    'watt2025', 'minileiste', 'fspro', 'mail.bg', 'fercam', 'dachser',
  ];
  const INVOICE_IN_SUBS = [
    'invoice number', 'фактура м', 'ф-ра м', 'dhl фактура', 'last dhl',
    'invoice', 'фактура', 'фактури', 'faktura', 'rechnung',
  ];

  // Outgoing invoices (sent from our accounting/erp system)
  const INVOICE_OUT_SUBS = [
    'фактура n:', 'фактура no:', 'от студио ботема',
  ];
  const INVOICE_OUT_SENDERS = ['micro.bg'];

  // Bank statements
  const BANK_SENDERS = ['teximbank'];
  const BANK_SUBS = [
    'bank account statement', 'банково извлечение', 'ддс вноска',
    'account statement', 'statement',
  ];

  // Offers/orders outgoing
  const OFFER_OUT_SUBS = ['оферта', 'offer', 'поръчка от', 'нова поръчка'];
  const OFFER_OUT_SENDERS = ['luminavera.com', 'superhosting.bg'];

  // Delivery notes
  const DELIVERY_SUBS = ['delivery note', 'изписване на стоки', 'cmr', 'товарителница'];
  const DELIVERY_SENDERS = ['dachser', 'fercam'];

  let ignored=0, invoiceIn=0, invoiceOut=0, bank=0, offer=0, delivery=0;

  for (const msg of pending) {
    const f = (msg.from||'').toLowerCase();
    const s = (msg.subject||'').toLowerCase();

    let status, type;

    if (IGNORE_SENDERS.some(x=>f.includes(x)) || IGNORE_SUBS.some(x=>s.includes(x))) {
      status='IGNORED'; type=null; ignored++;
    } else if (BANK_SENDERS.some(x=>f.includes(x)) || BANK_SUBS.some(x=>s.includes(x))) {
      status='CLASSIFIED'; type='BANK_STATEMENT'; bank++;
    } else if (INVOICE_OUT_SENDERS.some(x=>f.includes(x)) || INVOICE_OUT_SUBS.some(x=>s.includes(x))) {
      status='CLASSIFIED'; type='INVOICE_OUT'; invoiceOut++;
    } else if (DELIVERY_SENDERS.some(x=>f.includes(x)) || DELIVERY_SUBS.some(x=>s.includes(x))) {
      status='CLASSIFIED'; type='DELIVERY_NOTE'; delivery++;
    } else if (INVOICE_IN_SENDERS.some(x=>f.includes(x)) || INVOICE_IN_SUBS.some(x=>s.includes(x))) {
      status='CLASSIFIED'; type='INVOICE_IN'; invoiceIn++;
    } else if (OFFER_OUT_SENDERS.some(x=>f.includes(x)) || (OFFER_OUT_SUBS.some(x=>s.includes(x)) && msg.hasAttachments)) {
      status='CLASSIFIED'; type='OFFER_OUT'; offer++;
    } else {
      continue;
    }

    await prisma.$executeRaw`
      UPDATE gmail_messages SET status=${status}::"GmailMessageStatus", "classifiedType"=${type}, "updatedAt"=now()
      WHERE id=${msg.id}
    `;
  }

  console.log('Result:', { ignored, invoiceIn, invoiceOut, bankStatement:bank, offer, delivery });
  console.log('Total classified:', invoiceIn + invoiceOut + bank + offer + delivery);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
