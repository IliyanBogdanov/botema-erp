'use client';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';

const DOC_TYPE_LABELS: Record<string, string> = {
  PROFORMA: 'ПРОФОРМА ФАКТУРА',
  OFFER: 'ОФЕРТА',
  PROTOCOL: 'ПРИЕМО-ПРЕДАВАТЕЛЕН ПРОТОКОЛ',
  WARRANTY: 'ГАРАНЦИОННА КАРТА',
  DELIVERY_NOTE: 'ДОСТАВЪЧНА БЕЛЕЖКА',
  CREDIT_NOTE: 'КРЕДИТНО ИЗВЕСТИЕ',
  INVOICE: 'ФАКТУРА',
};

// Fallback if company not yet in DB
const COMPANY_FALLBACK: Record<string, any> = {
  STUDIO_BOTEMA: {
    name: 'СТУДИО БОТЕМА ЕООД',
    eik: '207416148',
    vat: 'BG207416148',
    address: 'ул. Тракия 28',
    city: 'София 1000',
    mol: 'Ботьо Богданов',
    bankIban: 'BG18UBBS80021030174631',
    bankBic: 'UBBSBGSF',
    bankName: 'ОББ',
    email: 'office@studiobotema.com',
    phone: '+359 888 123 456',
  },
  LUMINAVERA: {
    name: 'ЛУМИНАВЕРА ЕООД',
    eik: '207416149',
    vat: 'BG207416149',
    address: 'ул. Тракия 28',
    city: 'София 1000',
    mol: 'Ботьо Богданов',
    bankIban: 'BG18UBBS80021030174632',
    bankBic: 'UBBSBGSF',
    bankName: 'ОББ',
    email: 'office@luminavera.bg',
    phone: '+359 888 123 457',
  },
};

function fmtDate(d: string | Date) {
  return new Date(d).toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoney(n: number, currency = 'BGN') {
  const sym = currency === 'BGN' ? 'лв.' : currency === 'EUR' ? '€' : currency;
  return `${Number(n).toFixed(2)} ${sym}`;
}

export default function PrintDocPage() {
  const { id } = useParams<{ id: string }>();

  const { data: doc, isLoading } = useQuery({
    queryKey: ['issued-doc', id],
    queryFn: () => api.get(`/issued-docs/${id}`).then(r => r.data),
    enabled: !!id,
  });

  const { data: companiesData = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get('/company').then(r => r.data),
  });

  useEffect(() => {
    if (doc) {
      document.title = `${DOC_TYPE_LABELS[doc.type] || doc.type} ${doc.number}`;
    }
  }, [doc]);

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400">Зареждане...</div>;
  }
  if (!doc) {
    return <div className="flex items-center justify-center min-h-screen text-red-500">Документът не е намерен.</div>;
  }

  // Prefer DB data; fall back to hardcoded constants
  const companies: any[] = companiesData as any[];
  const dbCompany = companies.find((c: any) => c.brand === doc.brand);
  const fallback = COMPANY_FALLBACK[doc.brand] || COMPANY_FALLBACK.STUDIO_BOTEMA;
  const company = dbCompany
    ? {
        name: dbCompany.name,
        eik: dbCompany.eik,
        vat: dbCompany.vat,
        address: dbCompany.address,
        city: dbCompany.city,
        mol: dbCompany.mol,
        iban: dbCompany.bankIban,
        bic: dbCompany.bankBic,
        bank: dbCompany.bankName,
        email: dbCompany.email || fallback.email,
        phone: dbCompany.phone || fallback.phone,
      }
    : { ...fallback, iban: fallback.bankIban || fallback.iban, bic: fallback.bankBic || fallback.bic, bank: fallback.bankName || fallback.bank };
  const client = doc.client;
  const items = doc.items || [];
  const typeLabel = DOC_TYPE_LABELS[doc.type] || doc.type;

  const amountNet = Number(doc.amountNet) || 0;
  const vatAmount = Number(doc.vatAmount) || 0;
  const amountTotal = Number(doc.amountTotal) || 0;

  const isOffer = doc.type === 'OFFER';
  const isWarranty = doc.type === 'WARRANTY';
  const isProtocol = doc.type === 'PROTOCOL';

  return (
    <>
      {/* Print controls — hidden when printing */}
      <div className="print:hidden fixed top-0 left-0 right-0 bg-surface-container-low border-b border-outline-variant/20 px-6 py-3 flex items-center justify-between z-50">
        <div className="flex items-center gap-3">
          <button onClick={() => window.history.back()}
            className="flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-primary transition-colors">
            ← Назад
          </button>
          <span className="text-on-surface-variant/30">|</span>
          <span className="text-sm font-medium text-on-surface">{typeLabel} № {doc.number}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-on-surface-variant/60">Ctrl+P за запис като PDF</span>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-primary text-on-primary text-sm font-semibold hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            🖨 Принт / PDF
          </button>
        </div>
      </div>

      {/* A4 Document */}
      <div className="print:pt-0 pt-16 min-h-screen bg-gray-100 print:bg-white">
        <style>{`
          @media print {
            @page { size: A4; margin: 18mm 15mm; }
            body { font-family: Arial, sans-serif; color: #111; }
          }
          @media screen {
            .page { max-width: 210mm; margin: 2rem auto; padding: 18mm 15mm; background: white; box-shadow: 0 4px 24px rgba(0,0,0,0.15); }
          }
        `}</style>

        <div className="page" style={{ fontFamily: 'Arial, sans-serif', color: '#111' }}>
          {/* Header */}
          <table style={{ width: '100%', marginBottom: '24px', borderBottom: '2px solid #111', paddingBottom: '16px' }}>
            <tbody>
              <tr>
                <td style={{ verticalAlign: 'top', width: '60%' }}>
                  <div style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px', color: '#111' }}>
                    {company.name}
                  </div>
                  <div style={{ fontSize: '11px', color: '#555', marginTop: '4px', lineHeight: '1.6' }}>
                    ЕИК: {company.eik} | ДДС №: {company.vat}<br />
                    МОЛ: {company.mol}<br />
                    {company.address}, {company.city}<br />
                    {company.email} | {company.phone}
                  </div>
                </td>
                <td style={{ verticalAlign: 'top', textAlign: 'right' }}>
                  <div style={{ fontSize: '20px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#333' }}>
                    {typeLabel}
                  </div>
                  <div style={{ fontSize: '13px', color: '#555', marginTop: '6px', lineHeight: '1.8' }}>
                    <strong>№ {doc.number}</strong><br />
                    Дата: {fmtDate(doc.date)}<br />
                    {doc.dueDate && `Валидно до: ${fmtDate(doc.dueDate)}`}
                    {doc.project && <><br />Обект: {doc.project.code} – {doc.project.name}</>}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Client info */}
          {client && (
            <div style={{ marginBottom: '24px', padding: '12px', backgroundColor: '#f8f8f8', borderLeft: '3px solid #111' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#555', marginBottom: '6px' }}>
                {isOffer || isProtocol ? 'КЛИЕНТ / КОНТРАГЕНТ' : 'ПОЛУЧАТЕЛ'}
              </div>
              <div style={{ fontSize: '13px', fontWeight: 700 }}>{client.name}</div>
              <div style={{ fontSize: '11px', color: '#555', lineHeight: '1.7', marginTop: '3px' }}>
                {client.eik && `ЕИК: ${client.eik}`}
                {client.vat && ` | ДДС №: ${client.vat}`}
                {client.mol && <><br />МОЛ: {client.mol}</>}
                {(client.address || client.city) && <><br />{[client.address, client.city].filter(Boolean).join(', ')}</>}
              </div>
            </div>
          )}

          {/* Description */}
          {doc.description && (
            <div style={{ marginBottom: '20px', fontSize: '12px', color: '#333' }}>
              <strong>Относно:</strong> {doc.description}
            </div>
          )}

          {/* Line items table */}
          {items.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px', fontSize: '11px' }}>
              <thead>
                <tr style={{ backgroundColor: '#111', color: '#fff' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, width: '4%' }}>№</th>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Описание</th>
                  {isOffer && <th style={{ padding: '8px 6px', textAlign: 'center', width: '8%' }}>Снимка</th>}
                  <th style={{ padding: '8px 6px', textAlign: 'center', fontWeight: 600, width: '5%' }}>Ед.</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, width: '7%' }}>Кол.</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, width: '11%' }}>Ед. цена</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, width: '6%' }}>ДДС%</th>
                  <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600, width: '12%' }}>Сума с ДДС</th>
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
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontWeight: 500 }}>{item.description}</span>
                      </td>
                      {isOffer && (
                        <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                          {item.imageUrl && (
                            <img src={item.imageUrl} alt=""
                              style={{ width: '50px', height: '50px', objectFit: 'cover' }}
                              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                            />
                          )}
                        </td>
                      )}
                      <td style={{ padding: '8px 6px', textAlign: 'center', color: '#555' }}>{item.unit || 'бр.'}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{qty}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{price.toFixed(2)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: '#555' }}>{vat}%</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 600 }}>{fmtMoney(total, doc.currency)}</td>
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
                <td style={{ width: '60%' }}></td>
                <td>
                  <table style={{ width: '100%', fontSize: '12px' }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: '4px 10px', color: '#555' }}>Нето:</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right' }}>{fmtMoney(amountNet, doc.currency)}</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '4px 10px', color: '#555' }}>ДДС (20%):</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right' }}>{fmtMoney(vatAmount, doc.currency)}</td>
                      </tr>
                      <tr style={{ borderTop: '2px solid #111', fontWeight: 700, fontSize: '14px' }}>
                        <td style={{ padding: '8px 10px' }}>ОБЩО:</td>
                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmtMoney(amountTotal, doc.currency)}</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Warranty specific content */}
          {isWarranty && (
            <div style={{ marginBottom: '24px', border: '1px solid #ddd', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, marginBottom: '8px' }}>ГАРАНЦИОННИ УСЛОВИЯ</div>
              <div style={{ fontSize: '11px', color: '#444', lineHeight: '1.7' }}>
                Гаранционният срок е 24 месеца от датата на доставка.<br />
                Гаранцията не покрива повреди вследствие на неправилна употреба, механични наранявания или неспазване на инструкциите за монтаж.<br />
                При констатиран дефект, моля свържете се с нас на: {company.email} или {company.phone}.
              </div>
            </div>
          )}

          {/* Protocol signature section */}
          {isProtocol && (
            <div style={{ marginTop: '32px' }}>
              <div style={{ fontSize: '11px', marginBottom: '8px', color: '#555' }}>
                С подписването на настоящия протокол, страните потвърждават, че стоките/услугите са предадени/приети в описания вид и количество.
              </div>
              <table style={{ width: '100%', marginTop: '32px', fontSize: '11px' }}>
                <tbody>
                  <tr>
                    <td style={{ width: '45%', borderTop: '1px solid #333', paddingTop: '8px' }}>
                      <div>Предал: <strong>{company.name}</strong></div>
                      <div style={{ color: '#666', marginTop: '4px' }}>Дата: _______________</div>
                      <div style={{ color: '#666', marginTop: '4px' }}>Подпис: _______________</div>
                    </td>
                    <td style={{ width: '10%' }}></td>
                    <td style={{ width: '45%', borderTop: '1px solid #333', paddingTop: '8px' }}>
                      <div>Приел: <strong>{client?.name || '_______________'}</strong></div>
                      <div style={{ color: '#666', marginTop: '4px' }}>Дата: _______________</div>
                      <div style={{ color: '#666', marginTop: '4px' }}>Подпис: _______________</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Notes */}
          {doc.notes && (
            <div style={{ marginTop: '20px', padding: '12px', backgroundColor: '#f8f8f8', fontSize: '11px', color: '#555' }}>
              <strong>Бележки:</strong> {doc.notes}
            </div>
          )}

          {/* Bank details for proforma */}
          {(doc.type === 'PROFORMA' || doc.type === 'INVOICE') && (
            <div style={{ marginTop: '20px', fontSize: '11px', color: '#555', borderTop: '1px solid #ddd', paddingTop: '12px' }}>
              <strong>Банкова сметка:</strong> {company.iban} | BIC: {company.bic} | {company.bank}
            </div>
          )}

          {/* Footer */}
          <div style={{ marginTop: '32px', borderTop: '1px solid #ddd', paddingTop: '10px', fontSize: '10px', color: '#999', textAlign: 'center' }}>
            {company.name} | ЕИК {company.eik} | {company.address}, {company.city} | {company.email}
          </div>
        </div>
      </div>
    </>
  );
}
