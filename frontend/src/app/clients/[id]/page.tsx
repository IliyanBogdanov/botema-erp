'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';

interface ClientInvoice {
  id: string;
  number: string;
  date: string;
  dueDate?: string;
  status: string;
  amountNet: number;
  amountTotal: number;
  currency: string;
  project?: { id: string; code: string; name: string };
}

interface ClientDetail {
  id: string;
  name: string;
  type: string;
  eik?: string;
  vat?: string;
  city?: string;
  email?: string;
  phone?: string;
  brand?: string;
  notes?: string;
  invoiceCount: number;
  projectCount: number;
  totalRevenueBGN: number;
  totalVatBGN: number;
  outstandingBGN: number;
  revenueByYear: Record<string, number>;
  invoices: ClientInvoice[];
}

const STATUS_COLORS: Record<string, string> = {
  PAID:      'border-primary/30 bg-primary/5 text-primary',
  PENDING:   'border-warning/30 bg-warning/5 text-warning',
  OVERDUE:   'border-error/30 bg-error/5 text-error',
  CANCELLED: 'border-outline-variant/20 text-on-surface-variant/50',
};

export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: client, isLoading } = useQuery<ClientDetail>({
    queryKey: ['client', id],
    queryFn: () => api.get(`/clients/${id}`).then(r => r.data),
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

  if (!client) return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding flex items-center justify-center">
      <p className="text-on-surface-variant">Клиентът не е намерен.</p>
    </div>
  );

  const yearEntries = Object.entries(client.revenueByYear).sort((a, b) => Number(b[0]) - Number(a[0]));
  const maxYear = Math.max(...yearEntries.map(([, v]) => v), 1);
  const paidCount = client.invoices.filter(i => i.status === 'PAID').length;
  const overdueCount = client.invoices.filter(i => i.status === 'OVERDUE').length;

  return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding text-on-surface">
      <div className="mx-auto max-w-6xl space-y-8">

        {/* Breadcrumb + header */}
        <div>
          <Link href="/clients" className="flex items-center gap-1 font-label-caps text-label-caps text-on-surface-variant hover:text-primary mb-4 w-fit transition-colors">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            КЛИЕНТИ
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center bg-primary-container/10 border border-primary-container/20 font-headline text-xl text-primary">
                {client.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="font-headline text-headline-lg text-on-surface">{client.name}</h1>
                <p className="font-label-caps text-label-caps text-on-surface-variant mt-0.5">
                  {[client.type, client.city, client.brand].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {client.email && (
                <a href={`mailto:${client.email}`} className="btn-ghost flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">mail</span>
                  {client.email}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-surface-container-low border border-outline-variant/10 p-5">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">ПРИХОДИ НЕТО</p>
            <p className="font-headline text-headline-md text-on-surface">
              {client.totalRevenueBGN.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN
            </p>
          </div>
          <div className="bg-surface-container-low border border-outline-variant/10 p-5">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">НЕПЛАТЕНО</p>
            <p className={`font-headline text-headline-md ${client.outstandingBGN > 0 ? 'text-warning' : 'text-on-surface'}`}>
              {client.outstandingBGN.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN
            </p>
          </div>
          <div className="bg-surface-container-low border border-outline-variant/10 p-5">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">ФАКТУРИ</p>
            <p className="font-headline text-headline-md text-on-surface">
              {client.invoiceCount}
              <span className="text-sm text-on-surface-variant ml-2">({paidCount} платени)</span>
            </p>
          </div>
          <div className="bg-surface-container-low border border-outline-variant/10 p-5">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">ПРОЕКТИ</p>
            <p className="font-headline text-headline-md text-on-surface">
              {client.projectCount}
              {overdueCount > 0 && <span className="text-sm text-error ml-2">{overdueCount} просрочени</span>}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Info + year breakdown */}
          <div className="space-y-4">
            {/* Client info */}
            <div className="bg-surface-container-low border border-outline-variant/10 p-6">
              <h3 className="font-label-caps text-label-caps text-on-surface mb-4">ДАННИ</h3>
              <dl className="space-y-3">
                {[
                  { label: 'ЕИК', value: client.eik },
                  { label: 'ДДС №', value: client.vat },
                  { label: 'Телефон', value: client.phone },
                  { label: 'Град', value: client.city },
                ].filter(r => r.value).map(row => (
                  <div key={row.label} className="flex justify-between gap-2">
                    <dt className="font-label-caps text-[9px] text-on-surface-variant/60">{row.label}</dt>
                    <dd className="font-body-sm text-body-sm text-on-surface text-right">{row.value}</dd>
                  </div>
                ))}
              </dl>
              {client.notes && (
                <p className="mt-4 pt-4 border-t border-outline-variant/5 font-body-sm text-body-sm text-on-surface-variant">{client.notes}</p>
              )}
            </div>

            {/* Revenue by year */}
            {yearEntries.length > 0 && (
              <div className="bg-surface-container-low border border-outline-variant/10 p-6">
                <h3 className="font-label-caps text-label-caps text-on-surface mb-4">ПРИХОДИ ПО ГОДИНИ</h3>
                <div className="space-y-4">
                  {yearEntries.map(([year, amount]) => (
                    <div key={year} className="flex items-center gap-3">
                      <span className="font-label-caps text-[10px] text-on-surface-variant w-10 shrink-0">{year}</span>
                      <div className="flex-1 h-2 bg-surface-container-high overflow-hidden">
                        <div className="h-full bg-primary-container transition-all duration-700"
                          style={{ width: `${Math.round((amount / maxYear) * 100)}%` }} />
                      </div>
                      <span className="font-data-mono text-[11px] text-primary w-28 text-right shrink-0">
                        {amount.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Invoice history */}
          <div className="lg:col-span-2 bg-surface-container-low border border-outline-variant/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/5 flex items-center justify-between">
              <h3 className="font-label-caps text-label-caps text-on-surface">ИСТОРИЯ ФАКТУРИ</h3>
              <span className="font-data-mono text-data-mono text-on-surface-variant">{client.invoices.length} записа</span>
            </div>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">НОМЕР</th>
                  <th className="table-header">ДАТА</th>
                  <th className="table-header">ПРОЕКТ</th>
                  <th className="table-header text-right">НЕТО</th>
                  <th className="table-header text-right">ОБЩО</th>
                  <th className="table-header">СТАТУС</th>
                </tr>
              </thead>
              <tbody>
                {client.invoices.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-cell py-12 text-center text-on-surface-variant">Няма фактури</td>
                  </tr>
                ) : client.invoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-surface-container transition-colors">
                    <td className="table-cell font-data-mono text-data-mono">
                      <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">
                        {inv.number}
                      </Link>
                    </td>
                    <td className="table-cell text-on-surface-variant text-xs whitespace-nowrap">{fmtDate(inv.date)}</td>
                    <td className="table-cell text-on-surface-variant">
                      {inv.project ? (
                        <Link href={`/projects/${inv.project.id}`} className="hover:text-primary transition-colors">
                          {inv.project.code}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="table-cell text-right font-data-mono text-data-mono text-on-surface-variant">
                      {fmt(inv.amountNet, inv.currency)}
                    </td>
                    <td className="table-cell text-right font-data-mono text-data-mono text-on-surface">
                      {fmt(inv.amountTotal, inv.currency)}
                    </td>
                    <td className="table-cell">
                      <span className={`font-label-caps text-[9px] border px-2 py-0.5 ${STATUS_COLORS[inv.status] || 'border-outline-variant/20 text-on-surface-variant'}`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
