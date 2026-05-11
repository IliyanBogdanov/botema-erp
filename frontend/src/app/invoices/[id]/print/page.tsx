'use client';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

const COMPANY_FALLBACK: Record<string, any> = {
  STUDIO_BOTEMA: {
    name: 'СТУДИО БОТЕМА ЕООД', eik: '', vat: '', address: '', city: '',
    mol: '', bankIban: '', bankBic: '', bankName: 'ОББ',
    email: 'office@studiobotema.com', phone: '',
  },
  LUMINAVERA: {
    name: 'ЛУМИНАВЕРА ЕООД', eik: '', vat: '', address: '', city: '',
    mol: '', bankIban: '', bankBic: '', bankName: 'ОББ',
    email: 'office@luminavera.bg', phone: '',
  },
};

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number, currency = 'BGN') {
  const sym = currency === 'BGN' ? 'лв.' : currency === 'EUR' ? '€' : currency;
  return `${Number(n).toFixed(2)} ${sym}`;
}

export default function InvoicePrintPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const autoPrint = searchParams.get('print') === '1';

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const { data: companiesData = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get('/company').then(r => r.data),
  });

  useEffect(() => {
    if (invoice) {
      document.title = `Фактура ${invoice.number}`;
    }
  }, [invoice]);

  useEffect(() => {
    if (autoPrint && invoice && !isLoading) {
      const t = setTimeout(() => window.print(), 600);
      return () => clearTimeout(t);
    }
  }, [autoPrint, invoice, isLoading]);

  if (isLoading) return <div className="flex items-center justify-center min-h-screen text-gray-400">Зареждане...</div>;
  if (!invoice) return <div className="flex items-center justify-center min-h-screen text-red-500">Фактурата не е намерена.</div>;

  const companies: any[] = companiesData as any[];
  const dbCompany = companies.find((c: any) => c.brand === invoice.brand);
  const fallback = COMPANY_FALLBACK[invoice.brand] || COMPANY_FALLBACK.STUDIO_BOTEMA;
  const company = dbCompany
    ? {
        name: dbCompany.name, eik: dbCompany.eik, vat: dbCompany.vat,
        address: dbCompany.address, city: dbCompany.city, mol: dbCompany.mol,
        iban: dbCompany.bankIban, bic: dbCompany.bankBic, bank: dbCompany.bankName,
        email: dbCompany.email || fallback.email, phone: dbCompany.phone || fallback.phone,
      }
    : { ...fallback, iban: fallback.bankIban, bic: fallback.bankBic, bank: fallback.bankName };

  const client = invoice.client;
  const items = invoice.items || [];
  const amountNet = Number(invoice.amountNet) || 0;
  const vatAmount = Number(invoice.vatAmount) || 0;
  const amountTotal = Number(invoice.amountTotal) || 0;

  return (
    <>
      <div className="print:hidden fixed top-0 left-0 right-0 bg-surface-container-low border-b border-outline-variant/20 px-6 py-3 flex items-center justify-between z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => window.history.back()} className="flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-primary transition-colors">
            ← Назад
          </button>
          <span className="text-on-surface-variant/30">|</span>
          <span className="text-sm font-medium text-on-surface">Фактура № {invoice.number}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-on-surface-variant/60">Ctrl+P за запис като PDF</span>
          <button onClick={() => window.print()} className="px-4 py-2 bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-2">
            🖨 Принт / PDF
          </button>
        </div>
      </div>

      <div className="print:pt-0 pt-16 min-h-screen bg-gray-100 print:bg-white">
        <style>{`
          @media print { @page { size: A4; margin: 18mm 15mm; } body { font-family: Arial, sans-serif; color: #111; } }
          @media screen { .page { max-width: 210mm; margin: 2rem auto; padding: 18mm 15mm; background: white; box-shadow: 0 4px 24px rgba(0,0,0,0.15); } }
        `}</style>

        <div className="page" style={{ fontFamily: 'Arial, sans-serif', color: '#111' }}>
          {/* Header */}
          <table style={{ width: '100%', marginBottom: '24px', borderBottom: '2px solid #111', paddingBottom: '16px' }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: 'top', width: '60%' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px' }}>{company.name}</div>
                  <div style={{ fontSize: '11px', color: '#555', marginTop: '4px', lineHeight: '1.6' }}>
                    ЕИК: {company.eik} | ДДС №: {company.vat}<br />
                    МОЛ: {company.mol}<br />
                    {company.address}, {company.city}<br />
                    {company.email} | {company.phone}
                  </div>
                </td>
                <td style={{ verticalAlign: 'top', textAlign: 'right' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#333' }}>
                    ФАКТУРА
                  </div>
                  <div style={{ fontSize: '13px', color: '#555', marginTop: '6px', lineHeight: '1.8' }}>
                    <strong>№ {invoice.number}</strong><br />
                    Дата: {fmtDate(invoice.date)}<br />
                    {invoice.dueDate && `Падеж: ${fmtDate(invoice.dueDate)}`}
                    {invoice.project && <><br />Обект: {invoice.project.code} – {invoice.project.name}</>}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Client */}
          {client && (
            <div style={{ marginBottom: '24px', padding: '12px', backgroundColor: '#f8f8f8', borderLeft: '3px solid #111' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#555', marginBottom: '6px' }}>ПОЛУЧАТЕЛ</div>
              <div style={{ fontSize: '13px', fontWeight: 700 }}>{client.name}</div>
              <div style={{ fontSize: '11px', color: '#555', lineHeight: '1.7', marginTop: '3px' }}>
                {client.eik && `ЕИК: ${client.eik}`}{client.vat && ` | ДДС №: ${client.vat}`}
                {client.mol && <><br />МОЛ: {client.mol}</>}
                {(client.address || client.city) && <><br />{[client.address, client.city].filter(Boolean).join(', ')}</>}
              </div>
            </div>
          )}

          {invoice.description && (
            <div style={{ marginBottom: '20px', fontSize: '12px', color: '#333' }}>
              <strong>Относно:</strong> {invoice.description}
            </div>
          )}

          {/* Items */}
          {items.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', fontSize: '11px' }}>
              <thead>
                <tr style={{ backgroundColor: '#111', color: '#fff' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', width: '4%' }}>№</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left' }}>Описание</th>
                  <th style={{ padding: '8px 6px', textAlign: 'center', width: '5%' }}>Ед.</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', width: '7%' }}>Кол.</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', width: '11%' }}>Ед. цена</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', width: '6%' }}>ДДС%</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', width: '12%' }}>Сума</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: any, idx: number) => {
                  const qty = Number(item.qty) || 0;
                  const price = Number(item.unitPrice) || 0;
                  const vat = Number(item.vatPct) || 0;
                  const total = qty * price * (1 + vat / 100);
                  return (
                    <tr key={item.id} style={{ backgroundColor: idx % 2 === 0 ? '#fff' : '#fafafa', borderBottom: '1px solid #e5e5e5' }}>
                      <td style={{ padding: '8px 10px', color: '#777' }}>{idx + 1}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 500 }}>{item.description}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'center', color: '#555' }}>{item.unit || 'бр.'}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{qty}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{price.toFixed(2)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: '#555' }}>{vat}%</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(total, invoice.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Totals */}
          <table style={{ width: '100%', marginBottom: '24px' }}>
            <tbody>
              <tr>
                <td style={{ width: '60%' }} />
                <td>
                  <table style={{ width: '100%', fontSize: '12px' }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: '4px 10px', color: '#555' }}>Нето:</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right' }}>{fmtMoney(amountNet, invoice.currency)}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '4px 10px', color: '#555' }}>ДДС (20%):</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right' }}>{fmtMoney(vatAmount, invoice.currency)}</td>
                      </tr>
                      <tr style={{ borderTop: '2px solid #111', fontWeight: 700, fontSize: '14px' }}>
                        <td style={{ padding: '8px 10px' }}>ОБЩО:</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtMoney(amountTotal, invoice.currency)}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Bank details */}
          <div style={{ marginTop: '20px', fontSize: '11px', color: '#555', borderTop: '1px solid #ddd', paddingTop: '12px' }}>
            <strong>Банкова сметка:</strong> {company.iban} | BIC: {company.bic} | {company.bank}
          </div>

          {invoice.notes && (
            <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f8f8f8', fontSize: '11px', color: '#555' }}>
              <strong>Бележки:</strong> {invoice.notes}
            </div>
          )}

          <div style={{ marginTop: '32px', borderTop: '1px solid #ddd', paddingTop: '10px', fontSize: '10px', color: '#999', textAlign: 'center' }}>
            {company.name} | ЕИК {company.eik} | {company.address}, {company.city} | {company.email}
          </div>
        </div>
      </div>
    </>
  );
}
