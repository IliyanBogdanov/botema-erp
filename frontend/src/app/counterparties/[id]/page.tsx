'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';

const CLIENT_TYPE_LABELS: Record<string, string> = {
  COMPANY: 'Фирма', PERSON: 'Физическо лице', ET: 'ЕТ',
};
const TYPE_LABELS: Record<string, string> = {
  CLIENT: 'Клиент', SUPPLIER: 'Доставчик', COURIER: 'Куриер', BANK: 'Банка',
  ACCOUNTING: 'Счетоводство', DESIGNER: 'Дизайнер/архитект', OTHER: 'Друго',
};
const STATUS_COLORS: Record<string, string> = {
  PAID: 'border-primary/30 bg-primary/5 text-primary',
  PENDING: 'border-warning/30 bg-warning/5 text-warning',
  OVERDUE: 'border-error/30 bg-error/5 text-error',
  CANCELLED: 'border-outline-variant/20 text-on-surface-variant/50',
  MATCHED: 'border-primary/30 text-primary',
};

interface Detail {
  id: string; name: string; type: string;
  eik?: string; vat?: string; city?: string; address?: string; email?: string; phone?: string; notes?: string;
  country?: string; currency?: string; clientType?: string; brand?: string; mol?: string;
  // CLIENT
  invoiceCount?: number; projectCount?: number; totalRevenueBGN?: number; outstandingBGN?: number;
  revenueByYear?: Record<string, number>;
  invoices?: Array<{ id: string; number: string; date: string; status: string; amountNet: number; amountTotal: number; currency: string; project?: { id: string; code: string; name: string } }>;
  // SUPPLIER
  purchaseCount?: number; totalSpentEur?: number; totalsByYear?: Record<string, number>;
  purchases?: Array<{ id: string; invoiceNo?: string; date: string; amount: number; currency: string; amountEur: number; status: string; project?: { id: string; code: string; name: string } }>;
}

function YearBars({ entries, unit }: { entries: [string, number][]; unit: 'EUR' | 'BGN_TO_EUR' }) {
  const vals = entries.map(([, v]) => (unit === 'BGN_TO_EUR' ? v / 1.95583 : v));
  const max = Math.max(...vals, 1);
  return (
    <div className="space-y-4">
      {entries.map(([year, raw], i) => {
        const v = vals[i];
        return (
          <div key={year} className="flex items-center gap-3">
            <span className="font-label-caps text-[10px] text-on-surface-variant w-10 shrink-0">{year}</span>
            <div className="flex-1 h-2 bg-surface-container-high overflow-hidden">
              <div className="h-full bg-primary-container transition-all duration-700" style={{ width: `${Math.round((v / max) * 100)}%` }} />
            </div>
            <span className="font-data-mono text-[11px] text-primary w-24 text-right shrink-0">
              {v.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} €
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function CounterpartyDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: cp, isLoading } = useQuery<Detail>({
    queryKey: ['counterparty', id],
    queryFn: () => api.get(`/counterparties/${id}`).then(r => r.data),
  });

  if (isLoading) return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding animate-pulse">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="h-8 w-48 bg-surface-container-low" />
        <div className="h-32 bg-surface-container-low" />
        <div className="h-80 bg-surface-container-low" />
      </div>
    </div>
  );

  if (!cp) return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding flex items-center justify-center">
      <p className="text-on-surface-variant">Контрагентът не е намерен.</p>
    </div>
  );

  const isClient = cp.type === 'CLIENT';
  const isSupplier = cp.type === 'SUPPLIER';

  const revenueEntries = isClient ? Object.entries(cp.revenueByYear || {}).sort((a, b) => Number(b[0]) - Number(a[0])) : [];
  const spendEntries = isSupplier ? Object.entries(cp.totalsByYear || {}).sort((a, b) => Number(b[0]) - Number(a[0])) : [];
  const paidCount = cp.invoices?.filter(i => i.status === 'PAID').length || 0;

  return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding text-on-surface">
      <div className="mx-auto max-w-6xl space-y-8">

        <div>
          <Link href="/counterparties" className="flex items-center gap-1 font-label-caps text-label-caps text-on-surface-variant hover:text-primary mb-4 w-fit transition-colors">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            КОНТРАГЕНТИ
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center bg-primary-container/10 border border-primary-container/20 font-headline text-xl text-primary">
                {cp.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="font-headline text-headline-lg text-on-surface">{cp.name}</h1>
                <p className="font-label-caps text-label-caps text-on-surface-variant mt-0.5">
                  {[TYPE_LABELS[cp.type] || cp.type, isClient && cp.clientType ? CLIENT_TYPE_LABELS[cp.clientType] : null, cp.city || cp.country]
                    .filter(Boolean).join(' · ')}
                  {cp.brand === 'LUMINAVERA' && ' · Luminavera'}
                </p>
              </div>
            </div>
            {cp.email && (
              <a href={`mailto:${cp.email}`} className="btn-ghost flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">mail</span>
                {cp.email}
              </a>
            )}
          </div>
        </div>

        {/* KPI row */}
        {isClient && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-surface-container-low border border-outline-variant/10 p-5">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">ПРИХОДИ НЕТО</p>
              <p className="font-headline text-headline-md text-on-surface">{((cp.totalRevenueBGN || 0) / 1.95583).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} €</p>
            </div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-5">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">НЕПЛАТЕНО</p>
              <p className={`font-headline text-headline-md ${(cp.outstandingBGN || 0) > 0 ? 'text-warning' : 'text-on-surface'}`}>{((cp.outstandingBGN || 0) / 1.95583).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} €</p>
            </div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-5">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">ФАКТУРИ</p>
              <p className="font-headline text-headline-md text-on-surface">{cp.invoiceCount} <span className="text-sm text-on-surface-variant ml-2">({paidCount} платени)</span></p>
            </div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-5">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">ПРОЕКТИ</p>
              <p className="font-headline text-headline-md text-on-surface">{cp.projectCount}</p>
            </div>
          </div>
        )}
        {isSupplier && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-surface-container-low border border-outline-variant/10 p-5">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">ОБЩО ПОКУПКИ</p>
              <p className="font-headline text-headline-md text-on-surface">{cp.purchaseCount}</p>
            </div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-5">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">ИЗРАЗХОДВАНО EUR</p>
              <p className="font-headline text-headline-md text-on-surface">€{(cp.totalSpentEur || 0).toLocaleString('bg-BG', { maximumFractionDigits: 0 })}</p>
            </div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-5">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">ВАЛУТА</p>
              <p className="font-headline text-headline-md text-on-surface">{cp.currency || '—'}</p>
            </div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-5">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">ТЕЛЕФОН</p>
              <p className="font-headline text-headline-md text-on-surface">{cp.phone || '—'}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-4">
            <div className="bg-surface-container-low border border-outline-variant/10 p-6">
              <h3 className="font-label-caps text-label-caps text-on-surface mb-4">ДАННИ</h3>
              <dl className="space-y-3">
                {[
                  { label: 'ЕИК', value: cp.eik },
                  { label: 'ДДС №', value: cp.vat },
                  { label: 'МОЛ', value: cp.mol },
                  { label: 'Телефон', value: cp.phone },
                  { label: 'Адрес', value: [cp.address, cp.city].filter(Boolean).join(', ') || undefined },
                  { label: 'Държава', value: cp.country },
                ].filter(r => r.value).map(row => (
                  <div key={row.label} className="flex justify-between gap-2">
                    <dt className="font-label-caps text-[9px] text-on-surface-variant/60">{row.label}</dt>
                    <dd className="font-body-sm text-body-sm text-on-surface text-right">{row.value}</dd>
                  </div>
                ))}
              </dl>
              {cp.notes && <p className="mt-4 pt-4 border-t border-outline-variant/5 font-body-sm text-body-sm text-on-surface-variant">{cp.notes}</p>}
            </div>

            {isClient && revenueEntries.length > 0 && (
              <div className="bg-surface-container-low border border-outline-variant/10 p-6">
                <h3 className="font-label-caps text-label-caps text-on-surface mb-4">ПРИХОДИ ПО ГОДИНИ</h3>
                <YearBars entries={revenueEntries} unit="BGN_TO_EUR" />
              </div>
            )}
            {isSupplier && spendEntries.length > 0 && (
              <div className="bg-surface-container-low border border-outline-variant/10 p-6">
                <h3 className="font-label-caps text-label-caps text-on-surface mb-4">РАЗХОД ПО ГОДИНИ</h3>
                <YearBars entries={spendEntries} unit="EUR" />
              </div>
            )}
          </div>

          {isClient && (
            <div className="lg:col-span-2 bg-surface-container-low border border-outline-variant/10 overflow-hidden">
              <div className="px-6 py-4 border-b border-outline-variant/5 flex items-center justify-between">
                <h3 className="font-label-caps text-label-caps text-on-surface">ИСТОРИЯ ФАКТУРИ</h3>
                <span className="font-data-mono text-data-mono text-on-surface-variant">{cp.invoices?.length || 0} записа</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>
                    <th className="table-header">НОМЕР</th><th className="table-header">ДАТА</th><th className="table-header">ПРОЕКТ</th>
                    <th className="table-header text-right">НЕТО</th><th className="table-header text-right">ОБЩО</th><th className="table-header">СТАТУС</th>
                  </tr></thead>
                  <tbody>
                    {!cp.invoices?.length ? (
                      <tr><td colSpan={6} className="table-cell py-12 text-center text-on-surface-variant">Няма фактури</td></tr>
                    ) : cp.invoices.map(inv => (
                      <tr key={inv.id} className="hover:bg-surface-container transition-colors">
                        <td className="table-cell font-data-mono text-data-mono"><Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">{inv.number}</Link></td>
                        <td className="table-cell text-on-surface-variant text-xs whitespace-nowrap">{fmtDate(inv.date)}</td>
                        <td className="table-cell text-on-surface-variant">{inv.project ? <Link href={`/projects/${inv.project.id}`} className="hover:text-primary transition-colors">{inv.project.code}</Link> : '—'}</td>
                        <td className="table-cell text-right font-data-mono text-data-mono text-on-surface-variant">{fmt(inv.amountNet, inv.currency)}</td>
                        <td className="table-cell text-right font-data-mono text-data-mono text-on-surface">{fmt(inv.amountTotal, inv.currency)}</td>
                        <td className="table-cell"><span className={`font-label-caps text-[9px] border px-2 py-0.5 ${STATUS_COLORS[inv.status] || 'border-outline-variant/20 text-on-surface-variant'}`}>{inv.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {isSupplier && (
            <div className="lg:col-span-2 bg-surface-container-low border border-outline-variant/10 overflow-hidden">
              <div className="px-6 py-4 border-b border-outline-variant/5 flex items-center justify-between">
                <h3 className="font-label-caps text-label-caps text-on-surface">ИСТОРИЯ ПОКУПКИ</h3>
                <span className="font-data-mono text-data-mono text-on-surface-variant">{cp.purchases?.length || 0} записа</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>
                    <th className="table-header">ДАТА</th><th className="table-header">ФАКТУРА №</th><th className="table-header">ПРОЕКТ</th>
                    <th className="table-header text-right">СУМА</th><th className="table-header text-right">EUR</th><th className="table-header">СТАТУС</th>
                  </tr></thead>
                  <tbody>
                    {!cp.purchases?.length ? (
                      <tr><td colSpan={6} className="table-cell py-12 text-center text-on-surface-variant">Няма покупки</td></tr>
                    ) : cp.purchases.map(p => (
                      <tr key={p.id} className="hover:bg-surface-container transition-colors">
                        <td className="table-cell text-on-surface-variant text-xs whitespace-nowrap">{fmtDate(p.date)}</td>
                        <td className="table-cell font-data-mono text-data-mono text-on-surface">{p.invoiceNo || '—'}</td>
                        <td className="table-cell text-on-surface-variant">{p.project ? <Link href={`/projects/${p.project.id}`} className="hover:text-primary transition-colors">{p.project.code}</Link> : '—'}</td>
                        <td className="table-cell text-right font-data-mono text-data-mono text-on-surface">{fmt(p.amount, p.currency)}</td>
                        <td className="table-cell text-right font-data-mono text-data-mono text-primary">€{p.amountEur.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}</td>
                        <td className="table-cell"><span className={`font-label-caps text-[9px] border px-2 py-0.5 ${STATUS_COLORS[p.status] || 'border-outline-variant/20 text-on-surface-variant'}`}>{p.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!isClient && !isSupplier && (
            <div className="lg:col-span-2 bg-surface-container-low border border-outline-variant/10 p-8 flex items-center justify-center text-on-surface-variant">
              Няма допълнителна история за този тип контрагент.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
