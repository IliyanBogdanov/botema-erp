const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
async function main() {
  const payCount = await p.payment.count();
  const payCurr = await p.payment.groupBy({ by: ["currency"], _count: true });
  const payLatest = await p.payment.findMany({ orderBy: { date: "desc" }, take: 3, select: { date: true, currency: true, amount: true } });
  const payOldest = await p.payment.findMany({ orderBy: { date: "asc" }, take: 3, select: { date: true, currency: true, amount: true } });
  const invCount = await p.invoice.count();
  const invLatest = await p.invoice.findMany({ orderBy: { date: "desc" }, take: 3, select: { date: true, number: true, totalAmount: true } });
  const offerCount = await p.bizDocument.count({ where: { docType: "OFFER_OUT" } });
  const docCount = await p.document.count();
  console.log("Payments total:", payCount);
  console.log("Payments by currency:", JSON.stringify(payCurr));
  console.log("Latest payments:", JSON.stringify(payLatest));
  console.log("Oldest payments:", JSON.stringify(payOldest));
  console.log("Invoices total:", invCount);
  console.log("Latest invoices:", JSON.stringify(invLatest));
  console.log("OFFER_OUT docs:", offerCount);
  console.log("Documents total:", docCount);
}
main().catch(console.error).finally(() => p.$disconnect());
