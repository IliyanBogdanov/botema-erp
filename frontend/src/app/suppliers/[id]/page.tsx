'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';

const BIZ_DOC_STATUS_LABELS: Record<string, string> = {
  MATCHED: 'Платено (банка)', REVIEWED: 'Прегледано', IMPORTED: 'Импортирано',
};

interface Purchase {
  id: string;
  invoiceNo?: string;
  date: string;
  year: number;
  amount: number;
  currency: string;
  amountEur: number;
  description?: string;
  status: string;
  project?: { id: string; code: string; name: string };
}

interface SupplierDetail {
  id: string;
  name: string;
  country?: string;
  currency: string;
  discount?: string;
  email?: string;
  phone?: string;
  notes?: string;
  purchaseCount: number;
  totalSpentEur: number;
  totalsByYear: Record<string, number>;
  purchases: Purchase[];
}

function YearBar({ year, amount, max }: { year: string; amount: number; max: number }) {
  const pct = max > 0 ? Math.round((amount / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="font-label-caps text-[10px] text-on-surface-variant w-10 shrink-0">{year}</span>
      <div className="flex-1 h-2 bg-surface-container-high overflow-hidden">
        <div className="h-full bg-primary-container transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-data-mono text-[11px] text-primary w-24 text-right shrink-0">
        €{amount.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
      </span>
    </div>
  );
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: supplier, isLoading } = useQuery<SupplierDetail>({
    queryKey: ['supplier', id],
    queryFn: () => api.get(`/suppliers/${id}`).then(r => r.data),
  });

  if (isLoading) return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding">
      <div className="mx-auto max-w-6xl space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-surface-container-low" />
        <div className="h-32 bg-surface-container-low" />
        <div className="h-64 bg-surface-container-low" />
      </div>
    </div>
  );

  if (!supplier) return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding flex items-center justify-center">
      <p className="text-on-surface-variant">Доставчикът не е намерен.</p>
    </div>
  );

  const yearEntries = Object.entries(supplier.totalsByYear).sort((a, b) => Number(b[0]) - Number(a[0]));
  const maxYear = Math.max(...yearEntries.map(([, v]) => v), 1);

  return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding text-on-surface">
      <div className="mx-auto max-w-6xl space-y-8">

        {/* Breadcrumb + header */}
        <div>
          <Link href="/suppliers" className="flex items-center gap-1 font-label-caps text-label-caps text-on-surface-variant hover:text-primary mb-4 w-fit">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            ДОСТАВЧИЦИ
          </Link>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center bg-primary-container/10 border border-primary-container/20 font-headline text-xl text-primary">
                {supplier.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="font-headline text-headline-lg text-on-surface">{supplier.name}</h1>
                <p className="font-label-caps text-label-caps text-on-surface-variant mt-0.5">
                  {[supplier.country, supplier.currency].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            {supplier.email && (
              <a href={`mailto:${supplier.email}`} className="btn-ghost flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">mail</span>
                {supplier.email}
              </a>
            )}
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'ОБЩО ПОКУПКИ', value: String(supplier.purchaseCount) },
            { label: 'ИЗРАЗХОДВАНО EUR', value: `€${supplier.totalSpentEur.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}` },
            { label: 'ОТСТЪПКА', value: supplier.discount || '—' },
            { label: 'ТЕЛЕФОН', value: supplier.phone || '—' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-surface-container-low border border-outline-variant/10 p-5">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">{label}</p>
              <p className="font-headline text-headline-md text-on-surface">{value}</p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Year breakdown */}
          <div className="bg-surface-container-low border border-outline-variant/10 p-6">
            <h3 className="font-label-caps text-label-caps text-on-surface mb-6">РАЗХОД ПО ГОДИНИ</h3>
            <div className="space-y-4">
              {yearEntries.length === 0 ? (
                <p className="text-on-surface-variant/50 text-sm">Няма данни</p>
              ) : yearEntries.map(([year, amount]) => (
                <YearBar key={year} year={year} amount={amount} max={maxYear} />
              ))}
            </div>
            {supplier.notes && (
              <div className="mt-6 pt-6 border-t border-outline-variant/5">
                <p className="font-label-caps text-[9px] text-on-surface-variant/60 mb-2">БЕЛЕЖКИ</p>
                <p className="font-body-sm text-body-sm text-on-surface-variant">{supplier.notes}</p>
              </div>
            )}
          </div>

          {/* Purchase history */}
          <div className="lg:col-span-2 bg-surface-container-low border border-outline-variant/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/5 flex items-center justify-between">
              <h3 className="font-label-caps text-label-caps text-on-surface">ИСТОРИЯ ПОКУПКИ</h3>
              <span className="font-data-mono text-data-mono text-on-surface-variant">{supplier.purchases.length} записа</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">ДАТА</th>
                    <th className="table-header">ФАКТУРА №</th>
                    <th className="table-header">ПРОЕКТ</th>
                    <th className="table-header text-right">СУМА</th>
                    <th className="table-header text-right">EUR</th>
                    <th className="table-header">СТАТУС</th>
                  </tr>
                </thead>
                <tbody>
                  {supplier.purchases.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="table-cell py-12 text-center text-on-surface-variant">Няма покупки</td>
                    </tr>
                  ) : supplier.purchases.map(p => (
                    <tr key={p.id} className="hover:bg-surface-container transition-colors">
                      <td className="table-cell text-on-surface-variant text-xs whitespace-nowrap">{fmtDate(p.date)}</td>
                      <td className="table-cell font-data-mono text-data-mono text-on-surface">{p.invoiceNo || '—'}</td>
                      <td className="table-cell text-on-surface-variant">
                        {p.project ? (
                          <Link href={`/projects/${p.project.id}`} className="hover:text-primary transition-colors">
                            {p.project.code}
                          </Link>
                        ) : '—'}
                      </td>
                      <td className="table-cell text-right font-data-mono text-data-mono text-on-surface">
                        {fmt(p.amount, p.currency)}
                      </td>
                      <td className="table-cell text-right font-data-mono text-data-mono text-primary">
                        €{p.amountEur.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="table-cell">
                        <span className={`font-label-caps text-[9px] border px-2 py-0.5 ${
                          p.status === 'MATCHED' ? 'border-primary/30 text-primary' : 'border-outline-variant/20 text-on-surface-variant'
                        }`}>{BIZ_DOC_STATUS_LABELS[p.status] || p.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
