'use client';
import { useQuery } from '@tanstack/react-query';
import { api, fmtBgn, fmt, fmtDate } from '@/lib/api';
import Link from 'next/link';

const BGN_PER_EUR = 1.95583;

const BUCKET_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  CURRENT:      { label: 'ТЕКУЩИ',      color: '#30d158', bg: 'rgba(48,209,88,0.12)' },
  '1-30_DAYS':  { label: '1–30 ДНИ',   color: '#ff9f0a', bg: 'rgba(255,159,10,0.12)' },
  '31-60_DAYS': { label: '31–60 ДНИ',  color: '#ff6b35', bg: 'rgba(255,107,53,0.12)' },
  '61-90_DAYS': { label: '61–90 ДНИ',  color: '#ff453a', bg: 'rgba(255,69,58,0.12)' },
  OVER_90_DAYS: { label: '90+ ДНИ',    color: '#ff2d55', bg: 'rgba(255,45,85,0.18)' },
  NO_DUE_DATE:  { label: 'БЕЗ ДАТА',   color: '#636366', bg: 'rgba(99,99,102,0.12)' },
};

const BUCKET_ORDER = ['CURRENT', '1-30_DAYS', '31-60_DAYS', '61-90_DAYS', 'OVER_90_DAYS', 'NO_DUE_DATE'];

function toEur(amount: number, currency: string) {
  return currency === 'BGN' ? amount / BGN_PER_EUR : amount;
}

function BucketBar({ bucket, amount, total }: { bucket: string; amount: number; total: number }) {
  const cfg = BUCKET_LABELS[bucket] || BUCKET_LABELS.NO_DUE_DATE;
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return (
    <div className="flex items-center gap-4">
      <div className="w-28 shrink-0">
        <span className="font-label-caps text-[9px] tracking-[0.12em]" style={{ color: cfg.color }}>
          {cfg.label}
        </span>
      </div>
      <div className="flex-1 h-2 bg-surface-container-highest rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: cfg.color }} />
      </div>
      <span className="font-data-mono text-data-mono text-on-surface w-28 text-right">
        {amount.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} EUR
      </span>
      <span className="font-label-caps text-[9px] text-on-surface-variant/50 w-10 text-right">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

export default function AgedDebtorsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['invoice-aging'],
    queryFn: () => api.get('/invoices/aging').then(r => r.data),
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="p-container-padding">
        <div className="animate-pulse space-y-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 bg-surface-container-low rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const invoices: any[] = data?.invoices || [];
  const rawSummary: Record<string, number> = data?.summary || {};

  // Convert summary to EUR
  const summaryEur: Record<string, number> = Object.fromEntries(
    Object.entries(rawSummary).map(([k, v]) => [k, v / BGN_PER_EUR])
  );

  const totalEur = Object.values(summaryEur).reduce((s, v) => s + v, 0);
  const overdueEur = (summaryEur['1-30_DAYS'] || 0) + (summaryEur['31-60_DAYS'] || 0) +
    (summaryEur['61-90_DAYS'] || 0) + (summaryEur['OVER_90_DAYS'] || 0);

  // Group invoices by bucket
  const byBucket: Record<string, any[]> = {};
  for (const inv of invoices) {
    if (!byBucket[inv.bucket]) byBucket[inv.bucket] = [];
    byBucket[inv.bucket].push(inv);
  }

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="relative h-44 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-background via-surface-container-low to-background" />
        <div className="absolute top-0 right-0 w-80 h-80 bg-error/5 rounded-full blur-[80px] translate-x-1/3 -translate-y-1/3 pointer-events-none" />
        <div className="absolute inset-0 flex flex-col justify-end p-container-padding pb-8">
          <p className="font-label-caps text-label-caps text-primary/70 mb-2 tracking-[0.22em]">ФИНАНСИ</p>
          <h1 className="font-display text-display-lg text-on-surface italic leading-none">Падежен Анализ</h1>
          <p className="font-label-caps text-[10px] text-on-surface-variant/45 mt-2 tracking-[0.2em]">
            AGED DEBTORS · ВЗЕМАНИЯ ПО ФАКТУРИ
          </p>
        </div>
      </div>

      <div className="p-container-padding space-y-section-gap">

        {/* KPI Row */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
          <div className="bg-surface-container-low p-7 rounded-xl border border-outline-variant/8 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-error/5 rounded-bl-full translate-x-8 -translate-y-8 pointer-events-none" />
            <p className="font-label-caps text-[10px] text-on-surface-variant/60 mb-4 tracking-[0.14em]">ОБЩО ВЗЕМАНИЯ</p>
            <p className="font-display text-[44px] leading-none italic text-on-surface">
              {totalEur.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
              <span className="text-[18px] text-on-surface-variant/40 ml-2">EUR</span>
            </p>
            <p className="font-label-caps text-[9px] text-on-surface-variant/50 mt-3">{invoices.length} ФАКТУРИ</p>
          </div>

          <div className="bg-surface-container-low p-7 rounded-xl border border-error/15 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-error/8 rounded-bl-full translate-x-8 -translate-y-8 pointer-events-none" />
            <p className="font-label-caps text-[10px] text-error/70 mb-4 tracking-[0.14em]">ПРОСРОЧЕНИ</p>
            <p className="font-display text-[44px] leading-none italic text-error">
              {overdueEur.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
              <span className="text-[18px] text-error/40 ml-2">EUR</span>
            </p>
            <p className="font-label-caps text-[9px] text-error/50 mt-3">
              {totalEur > 0 ? ((overdueEur / totalEur) * 100).toFixed(1) : 0}% ОТ ОБЩОТО
            </p>
          </div>

          <div className="bg-surface-container-low p-7 rounded-xl border border-outline-variant/8">
            <p className="font-label-caps text-[10px] text-on-surface-variant/60 mb-4 tracking-[0.14em]">90+ ДНИ ПРОСРОЧЕНИ</p>
            <p className={`font-display text-[44px] leading-none italic ${(summaryEur['OVER_90_DAYS'] || 0) > 0 ? 'text-error' : 'text-primary'}`}>
              {(summaryEur['OVER_90_DAYS'] || 0).toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
              <span className="text-[18px] text-on-surface-variant/40 ml-2">EUR</span>
            </p>
            <p className="font-label-caps text-[9px] text-on-surface-variant/50 mt-3">КРИТИЧНО ПРОСРОЧЕНИ</p>
          </div>
        </section>

        {/* Aging Bars */}
        <section className="bg-surface-container-low p-8 rounded-xl border border-outline-variant/8">
          <h2 className="font-label-caps text-label-caps text-on-surface mb-8">РАЗПРЕДЕЛЕНИЕ ПО ПАДЕЖ</h2>
          <div className="space-y-5">
            {BUCKET_ORDER.map(bucket => {
              const amt = summaryEur[bucket] || 0;
              if (amt === 0) return null;
              return <BucketBar key={bucket} bucket={bucket} amount={amt} total={totalEur} />;
            })}
          </div>
        </section>

        {/* Invoice List by Bucket */}
        {BUCKET_ORDER.map(bucket => {
          const list = byBucket[bucket];
          if (!list?.length) return null;
          const cfg = BUCKET_LABELS[bucket] || BUCKET_LABELS.NO_DUE_DATE;
          const bucketTotal = list.reduce((s, inv) => s + toEur(Number(inv.amountTotal), inv.currency), 0);

          return (
            <section key={bucket} className="bg-surface-container-low rounded-xl border border-outline-variant/8 overflow-hidden">
              {/* Section header */}
              <div className="flex items-center justify-between p-6 border-b border-outline-variant/8"
                style={{ background: cfg.bg }}>
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full" style={{ background: cfg.color }} />
                  <span className="font-label-caps text-label-caps" style={{ color: cfg.color }}>{cfg.label}</span>
                  <span className="font-label-caps text-[9px] text-on-surface-variant/60">{list.length} фактури</span>
                </div>
                <span className="font-data-mono text-data-mono" style={{ color: cfg.color }}>
                  {bucketTotal.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} EUR
                </span>
              </div>

              {/* Invoice rows */}
              <div className="divide-y divide-outline-variant/5">
                {list.sort((a: any, b: any) => (b.daysOverdue || 0) - (a.daysOverdue || 0)).map((inv: any) => {
                  const amtEur = toEur(Number(inv.amountTotal), inv.currency);
                  return (
                    <div key={inv.id} className="flex items-center gap-6 px-6 py-4 hover:bg-surface-container-high/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-label-caps text-[10px] text-primary">{inv.number}</span>
                          {inv.daysOverdue !== null && inv.daysOverdue > 0 && (
                            <span className="px-1.5 py-0.5 font-label-caps text-[8px] rounded" style={{ background: cfg.bg, color: cfg.color }}>
                              +{inv.daysOverdue} дни
                            </span>
                          )}
                        </div>
                        <p className="font-body-sm text-on-surface mt-0.5 truncate">{inv.clientName || '—'}</p>
                        <p className="font-label-caps text-[9px] text-on-surface-variant/50 mt-0.5">
                          {inv.date ? fmtDate(inv.date) : '—'}
                          {inv.dueDate ? ` · Падеж: ${fmtDate(inv.dueDate)}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-data-mono text-data-mono text-on-surface">
                          {amtEur.toLocaleString('bg-BG', { maximumFractionDigits: 2 })} EUR
                        </p>
                        <p className="font-label-caps text-[9px] text-on-surface-variant/50 mt-0.5 uppercase">{inv.status}</p>
                      </div>
                      <Link href={`/invoices/${inv.id}`}
                        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border border-outline-variant/10 hover:bg-surface-container-highest transition-colors">
                        <span className="material-symbols-outlined text-[16px] text-on-surface-variant">arrow_forward</span>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {invoices.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <span className="material-symbols-outlined text-primary text-5xl mb-4">check_circle</span>
            <p className="font-headline text-headline-md text-on-surface">Всички фактури са платени!</p>
            <p className="font-body-sm text-on-surface-variant mt-2">Няма неплатени вземания.</p>
          </div>
        )}
      </div>
    </div>
  );
}
