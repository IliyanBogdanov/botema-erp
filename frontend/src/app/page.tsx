'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { RevenueChart } from '@/components/RevenueChart';
import { useState, useEffect } from 'react';
import { useT } from '@/lib/i18n';

// Premium Unsplash interiors — stable CDN URLs
const HERO_IMG = 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1600&auto=format&q=80';

// Rotating interior images pool for project gallery
const PROJ_IMG_POOL = [
  'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=600&auto=format&q=75',
  'https://images.unsplash.com/photo-1600210492493-0946911123ea?w=600&auto=format&q=75',
  'https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=600&auto=format&q=75',
  'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&auto=format&q=75',
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=600&auto=format&q=75',
  'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=600&auto=format&q=75',
];

function exportDashboardCsv(data: any, year: number) {
  const kpis = data?.kpis || {};
  const rows: string[][] = [
    ['Studio Botema ERP — Dashboard Export', String(year)],
    [],
    ['KPI', 'Стойност (EUR)'],
    ['Приходи (EUR)', String(((kpis.revenueEur || kpis.revenue / 1.95583) || 0).toFixed(2))],
    ['Разходи EUR', String(kpis.totalPurchasesEur || 0)],
    ['Брой покупки', String(kpis.totalPurchasesCount || 0)],
    ['Брой фактури', String(kpis.invoiceCount || 0)],
    ['Брутен марж %', String(kpis.grossMargin || 0)],
    [],
    ['Топ доставчици', 'EUR'],
    ...(data?.topSuppliers || []).map((s: any) => [s.name, String(s.amount)]),
    [],
    ['Топ клиенти', 'EUR нето'],
    ...(data?.topClients || []).map((c: any) => [c.name, String((c.revenue / 1.95583).toFixed(2))]),
    [],
    ['Приходи по месец', 'EUR', 'Бранд'],
    ...(data?.revenueByMonth || []).map((m: any) => [
      `Месец ${m.month}`, String((Number(m.revenue || 0) / 1.95583).toFixed(2)), m.brand || '',
    ]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `botema-dashboard-${year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DashboardPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const qc = useQueryClient();

  // Sync pipeline state
  const [syncJobId, setSyncJobId] = useState<string | null>(null);
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncDone, setSyncDone] = useState(false);

  useEffect(() => {
    if (!syncJobId || !syncRunning) return;
    const iv = setInterval(async () => {
      try {
        const { data: job } = await api.get(`/backfill/job/${syncJobId}`);
        if (job.status === 'done' || job.status === 'error') {
          setSyncRunning(false);
          setSyncDone(job.status === 'done');
          clearInterval(iv);
          qc.invalidateQueries();
        }
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(iv);
  }, [syncJobId, syncRunning]);

  const syncNow = useMutation({
    mutationFn: () => api.post('/backfill/run-all').then(r => r.data),
    onSuccess: (data: any) => { setSyncJobId(data.jobId); setSyncRunning(true); setSyncDone(false); },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', year],
    queryFn: () => api.get(`/dashboard?year=${year}`).then(r => r.data),
  });
  const { data: pendingDocsRaw } = useQuery({
    queryKey: ['pending-docs'],
    queryFn: () => api.get('/documents?status=PENDING&limit=5').then(r => r.data),
    refetchInterval: 30000,
  });
  // Support both array and {data:[]} response shapes
  const pendingDocs: any[] = Array.isArray(pendingDocsRaw)
    ? pendingDocsRaw
    : (pendingDocsRaw as any)?.data || [];

  const { data: activeProjects = [] } = useQuery({
    queryKey: ['active-projects'],
    queryFn: () => api.get('/projects?status=ACTIVE&limit=3').then(r => r.data),
  });
  const projList: any[] = Array.isArray(activeProjects)
    ? activeProjects.slice(0, 3)
    : (activeProjects as any)?.data?.slice(0, 3) || [];
  const { data: alertsList = [] } = useQuery({
    queryKey: ['dashboard-alerts'],
    queryFn: () => api.get('/alerts?status=ACTIVE&limit=5').then(r => r.data),
    refetchInterval: 60000,
  });
  const { data: vat } = useQuery({
    queryKey: ['vat-overview', year],
    queryFn: () => api.get(`/vat/overview?year=${year}`).then(r => r.data),
  });
  const t = useT();

  if (isLoading) return <LoadingSkeleton />;

  const kpis = data?.kpis || {};
  const margin = parseFloat(kpis.grossMargin || 0);
  const totalPurchasesEur = Number(kpis.totalPurchasesEur || 0);
  const totalPurchasesCount = Number(kpis.totalPurchasesCount || 0);
  const topSuppliers: [string, number][] = (data?.topSuppliers || []).map((supplier: any) => [supplier.name, Number(supplier.amount || 0)]);
  const maxSupplier = topSuppliers[0]?.[1] || 1;
  const bankRecon = data?.bankReconciliation || { total: 0, matched: 0, partial: 0, unmatched: 0 };
  const matchRate = bankRecon.total > 0 ? Math.round((bankRecon.matched / bankRecon.total) * 100) : 0;
  const barOpacity = [1, 0.8, 0.6, 0.4, 0.25];

  // Period context
  const today = new Date();
  const isCurrentYear = year === today.getFullYear();
  const BG_MONTHS = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];
  const periodEnd = isCurrentYear
    ? `${today.getDate()} ${BG_MONTHS[today.getMonth()]} ${year}`
    : `31 Дек ${year}`;
  const periodLabel = `01 Яну ${year} — ${periodEnd}`;

  return (
    <div className="min-h-screen">

      {/* ── HERO BANNER ─────────────────────────────────────────────────────── */}
      <div className="relative h-72 overflow-hidden">
        <img
          src={HERO_IMG}
          alt="Studio Botema interior"
          className="w-full h-full object-cover object-center scale-105"
          style={{ filter: 'brightness(0.35) saturate(0.7)' }}
        />
        {/* gradient: left solid, right transparent */}
        <div className="absolute inset-0 bg-gradient-to-r from-background/98 via-background/65 to-transparent" />
        {/* subtle ambient glow */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-primary-container/8 rounded-full blur-[100px] -translate-y-1/3 translate-x-1/4 pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-64 h-64 bg-primary-container/5 rounded-full blur-3xl pointer-events-none" />

        {/* overlaid text */}
        <div className="absolute inset-0 flex flex-col justify-end p-container-padding pb-10">
          <p className="font-label-caps text-label-caps text-primary/80 mb-3 tracking-[0.22em]">{t('dash.overviewLabel')}</p>
          <h2 className="font-display text-display-lg text-on-surface italic leading-none">{t('dash.title')}</h2>
          <p className="font-label-caps text-[10px] text-on-surface-variant/45 mt-3 tracking-[0.2em]">
            Studio Botema ЕООД · {year}
          </p>
        </div>

        {/* year + export row pinned bottom-right of hero */}
        <div className="absolute bottom-8 right-container-padding flex gap-3">
          <div className="flex gap-1 border border-outline-variant/20 bg-surface/40 backdrop-blur-md rounded-md p-1">
            {[2024, 2025, 2026].map(y => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`px-4 py-1.5 font-label-caps text-label-caps rounded-sm transition-colors ${
                  year === y
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
          <button
            className="border border-outline-variant/20 bg-surface/40 backdrop-blur-md rounded-md px-5 py-2 font-label-caps text-label-caps text-on-surface-variant hover:text-on-surface transition-colors"
            onClick={() => data && exportDashboardCsv(data, year)}
            disabled={!data}
          >
            {t('dash.exportReport')}
          </button>
          <button
            onClick={() => syncNow.mutate()}
            disabled={syncRunning || syncNow.isPending}
            style={{
              background: syncDone ? '#30d158' : syncRunning ? '#3a3a3c' : '#0a84ff',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 12,
              fontWeight: 600,
              cursor: syncRunning ? 'not-allowed' : 'pointer',
              opacity: syncRunning ? 0.8 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              whiteSpace: 'nowrap',
            }}
          >
            {syncRunning ? '⏳ Синхронизира...' : syncDone ? '✅ Готово' : '🔄 Синхронизирай данните'}
          </button>
        </div>
      </div>
      {syncRunning && (
        <div style={{ background: '#1c1c1e', borderTop: '1px solid #3a3a3c', padding: '8px 24px', fontSize: 12, color: '#8e8e93' }}>
          ⏳ Импортира данни от Gmail, Drive и PDF фактури — може да отнеме 5–15 мин...
        </div>
      )}

      <div className="p-container-padding space-y-section-gap">

        {/* ── ALERT BANNERS ──────────────────────────────────────────────────── */}
        {(Array.isArray(alertsList) ? alertsList : []).length > 0 && (
          <div className="bg-surface-container-low rounded-xl border border-error/15 border-l-4 border-l-error p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-error">warning</span>
              <div>
                <div className="font-label-caps text-label-caps text-on-surface">
                  {alertsList.length} {t('alerts.active').toUpperCase()}
                </div>
                <div className="text-body-sm text-on-surface-variant mt-0.5 truncate max-w-xl">
                  {(alertsList as any[])[0]?.title}
                </div>
              </div>
            </div>
            <a href="/alerts" className="font-label-caps text-label-caps text-primary hover:opacity-80">{t('dash.viewAll')} →</a>
          </div>
        )}
        {pendingDocs.length > 0 && (
          <div className="bg-surface-container-low rounded-xl border border-outline-variant/8 border-l-4 border-l-primary-container p-4 flex items-center justify-between -mt-8">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-primary-container animate-pulse" />
              <span className="font-label-caps text-label-caps text-on-surface">
                {pendingDocs.length} {t('dash.pendingReview')}
              </span>
            </div>
            <a href="/documents" className="font-label-caps text-label-caps text-primary hover:opacity-80">{t('doc.reviewed').toUpperCase()} →</a>
          </div>
        )}

        {/* ── YTD PERIOD BANNER (current year only) ──────────────────────────── */}
        {isCurrentYear && (
          <div className="bg-surface-container-low rounded-xl border border-outline-variant/8 border-l-4 border-l-primary-container/40 px-5 py-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-primary/50 text-[18px]">info</span>
            <p className="font-label-caps text-[10px] text-on-surface-variant/60 tracking-[0.1em]">
              ДАННИТЕ СА ЗА ПЕРИОДА <span className="text-on-surface/70">{periodLabel}</span> — РАЗХОДИТЕ ВКЛЮЧВАТ АВАНСОВИ ПОКУПКИ ЗА БЪДЕЩИ ДОСТАВКИ
            </p>
          </div>
        )}

        {/* ── KPI CARDS ──────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
          {/* EUR */}
          <div className="bg-surface-container-low p-7 rounded-xl border border-outline-variant/8 relative overflow-hidden group hover:border-primary-container/20 hover:shadow-[0_0_48px_rgba(62,144,255,0.07)] transition-all duration-300">
            <div className="absolute top-0 right-0 w-40 h-40 bg-primary-container/5 rounded-bl-full translate-x-12 -translate-y-12 group-hover:scale-110 transition-transform duration-500" />
            <div className="absolute top-4 right-4 w-1.5 h-1.5 rounded-full bg-primary-container shadow-[0_0_8px_rgba(62,144,255,0.6)]" />
            <p className="font-label-caps text-[10px] text-on-surface-variant/60 mb-5 tracking-[0.14em]">{t('dash.totalEur')}</p>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[40px] leading-none text-on-surface italic tracking-tight">
                {totalPurchasesEur.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
              </span>
              <span className="font-label-caps text-[11px] text-primary tracking-[0.15em]">EUR</span>
            </div>
            <div className="mt-5 flex items-center gap-2 text-primary/60">
              <span className="material-symbols-outlined text-[14px]">calendar_today</span>
              <span className="font-label-caps text-[9px] tracking-[0.12em]">{periodLabel}{isCurrentYear ? ' (ЯНУ)' : ''} · {t('dash.allCurrCombined')}</span>
            </div>
          </div>

          {/* EUR Revenue */}
          <div className="bg-surface-container-low p-7 rounded-xl border border-outline-variant/8 relative overflow-hidden hover:border-outline-variant/12 transition-all duration-300">
            <p className="font-label-caps text-[10px] text-on-surface-variant/60 mb-5 tracking-[0.14em]">{t('dash.revenueBgn')}</p>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-[40px] leading-none text-on-surface italic tracking-tight">
                {(kpis.revenueEur || 0).toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
              </span>
              <span className="font-label-caps text-[11px] text-secondary-fixed-dim tracking-[0.15em]">EUR</span>
            </div>
            <div className="mt-5 h-px bg-outline-variant/20 overflow-hidden rounded-full">
              <div
                className="h-full bg-primary-container/50 rounded-full transition-all duration-1000"
                style={{ width: `${Math.min(100, kpis.revenueEur > 0 ? Math.round(((kpis.costsEur || kpis.costs / 1.95583) / kpis.revenueEur) * 100) : 0)}%` }}
              />
            </div>
            <div className="mt-3 flex items-center gap-2 text-on-surface-variant/40">
              <span className="material-symbols-outlined text-[14px]">calendar_today</span>
              <span className="font-label-caps text-[9px] tracking-[0.12em]">Нетни приходи · {periodLabel}</span>
            </div>
          </div>

          {/* Margin */}
          <div className="bg-surface-container-low p-7 rounded-xl border border-outline-variant/8 relative overflow-hidden hover:border-outline-variant/12 transition-all duration-300">
            <p className="font-label-caps text-[10px] text-on-surface-variant/60 mb-5 tracking-[0.14em]">{t('dash.grossMargin')}</p>
            <div className="flex items-baseline gap-1">
              <span className={`font-display text-[40px] leading-none italic tracking-tight ${margin < -30 ? 'text-error/80' : 'text-on-surface'}`}>{margin || '—'}</span>
              {margin !== 0 && <span className="font-label-caps text-[18px] text-on-surface-variant/40 self-end mb-2">%</span>}
            </div>
            <div className="mt-5 flex items-center gap-2 text-on-surface-variant/40">
              <span className="material-symbols-outlined text-[14px]">analytics</span>
              <span className="font-label-caps text-[9px] tracking-[0.12em]">{kpis.invoiceCount || 0} {t('dash.invoices')} · {periodLabel}</span>
            </div>
            {margin < -30 && isCurrentYear && (
              <div className="mt-3 px-2 py-1.5 bg-error/5 border border-error/15 rounded text-[9px] font-label-caps text-error/70 leading-relaxed">
                ⚠ YTD: разходите включват авансови покупки за бъдещи проекти
              </div>
            )}
          </div>
        </section>

        {/* ── BENTO GRID (Suppliers + AI Docs) ──────────────────────────────── */}
        <section className="grid grid-cols-12 gap-gutter">

          {/* Top Suppliers — col 8 */}
          <div className="col-span-12 lg:col-span-8 bg-surface-container-low p-8 rounded-xl border border-outline-variant/8">
            <div className="flex justify-between items-center mb-10">
              <h3 className="font-label-caps text-label-caps text-on-surface">{t('dash.suppliers')}</h3>
              <span className="font-data-mono text-data-mono text-on-surface-variant">{topSuppliers.length} доставчика</span>
            </div>
            <div className="space-y-7">
              {topSuppliers.map(([name, amount], i) => (
                <div key={name} className="space-y-2 group/bar">
                  <div className="flex justify-between font-label-caps text-[10px]">
                    <span className="text-on-surface uppercase tracking-widest">{name}</span>
                    <span className="text-primary font-data-mono">
                      {amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} EUR
                    </span>
                  </div>
                  <div className="h-3 bg-surface-container-highest relative overflow-hidden">
                    <div
                      className="h-full bg-primary-container transition-all duration-1000"
                      style={{
                        width: `${Math.round((amount / maxSupplier) * 100)}%`,
                        opacity: barOpacity[i] ?? 0.25,
                      }}
                    />
                    {/* shimmer on hover */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover/bar:translate-x-full transition-transform duration-700" />
                  </div>
                </div>
              ))}
              {topSuppliers.length === 0 && (
                <p className="text-on-surface-variant font-body-sm text-body-sm opacity-60">Все още няма данни за покупки.</p>
              )}
            </div>

            {/* Stats row */}
            <div className="mt-10 grid grid-cols-4 border-t border-outline-variant/10 pt-6 gap-4">
              <div className="text-center">
                <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">{t('dash.totalPurchases')}</p>
                <p className="font-data-mono text-on-surface text-lg">
                  {totalPurchasesCount}
                </p>
              </div>
              <div className="text-center">
                <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">{t('dash.activeSuppliers')}</p>
                <p className="font-data-mono text-on-surface text-lg">{topSuppliers.length}</p>
              </div>
              <div className="text-center">
                <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">{t('dash.totalCost')}</p>
                <p className="font-data-mono text-primary text-lg">
                  {totalPurchasesEur.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} EUR
                </p>
              </div>
              <div className="text-center">
                <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">{t('dash.invoices')}</p>
                <p className="font-data-mono text-on-surface text-lg">{kpis.invoiceCount || '—'}</p>
              </div>
            </div>
          </div>

          {/* AI Document Center — col 4 */}
          <div className="col-span-12 lg:col-span-4 bg-surface-container-high p-8 rounded-xl border border-outline-variant/8 relative overflow-hidden">
            {/* accent glow */}
            <div className="absolute top-0 right-0 w-40 h-40 bg-primary-container/6 rounded-full blur-2xl pointer-events-none" />
            <div className="flex items-center gap-2 mb-8 relative">
              <span className="material-symbols-outlined text-primary">auto_awesome</span>
              <h3 className="font-label-caps text-label-caps text-on-surface">{t('dash.aiCenter')}</h3>
            </div>
            <div className="space-y-5 relative">
              {pendingDocs.slice(0, 4).map((doc: any) => {
                const data = doc.extractedData || {};
                const name = data.supplierName || data.clientName || doc.filename?.replace(/\.[^.]+$/, '').slice(0, 30) || 'Document';
                const amount = data.amountTotal || data.amount;
                return (
                  <div key={doc.id} className="flex items-start gap-4 pb-5 border-b border-outline-variant/5 last:border-0 last:pb-0">
                    <div className="w-10 h-10 bg-primary-container/10 border border-primary-container/20 flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-primary text-[18px]">description</span>
                    </div>
                    <div className="flex-1 overflow-hidden">
                      <p className="font-body-sm text-on-surface truncate text-[13px]">{name}</p>
                      {amount ? (
                        <p className="font-data-mono text-[10px] text-primary mt-0.5">
                          {Number(amount).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} {data.currency || 'EUR'}
                        </p>
                      ) : (
                        <p className="font-label-caps text-[9px] text-on-surface-variant/60 mt-0.5 truncate">{doc.filename?.slice(0, 28)}</p>
                      )}
                      <div className="mt-2">
                        <span className="px-2 py-0.5 bg-primary-container/15 text-primary font-label-caps text-[8px] border border-primary-container/20">
                          {t('dash.pendingReview')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {(Array.isArray(pendingDocs) ? pendingDocs : []).length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center opacity-50">
                  <span className="material-symbols-outlined text-on-surface-variant text-4xl mb-3">check_circle</span>
                  <p className="font-label-caps text-label-caps text-on-surface-variant">{t('dash.allClear')}</p>
                </div>
              )}
            </div>
            <a href="/documents" className="block w-full mt-8 py-3 rounded-lg border border-outline-variant/15 font-label-caps text-label-caps text-center text-on-surface-variant hover:bg-surface-variant/10 transition-colors relative">
              {t('dash.viewQueue')}
            </a>
          </div>
        </section>

        {/* ── BANK RECONCILIATION STATUS ─────────────────────────────────────── */}
        <section className="bg-surface-container-low rounded-xl border border-outline-variant/8 p-6 flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex items-center gap-3 shrink-0">
            <span className="material-symbols-outlined text-primary">account_balance</span>
            <div>
              <p className="font-label-caps text-label-caps text-on-surface-variant">БАНКОВА РЕКОН.</p>
              <p className="font-headline text-headline-md text-on-surface mt-0.5">{matchRate}%</p>
            </div>
          </div>
          <div className="flex-1">
            <div className="h-2 bg-surface-container-highest overflow-hidden mb-2">
              <div
                className={`h-full transition-all duration-1000 ${matchRate >= 80 ? 'bg-primary-container' : matchRate >= 50 ? 'bg-secondary-container' : 'bg-error'}`}
                style={{ width: `${matchRate}%` }}
              />
            </div>
            <div className="flex gap-6 font-label-caps text-[10px] text-on-surface-variant">
              <span><span className="text-primary font-data-mono">{bankRecon.matched}</span> Съвпад.</span>
              <span><span className="text-on-surface font-data-mono">{bankRecon.partial}</span> Частично</span>
              <span><span className="text-error font-data-mono">{bankRecon.unmatched}</span> Несъвп.</span>
              <span className="ml-auto"><span className="font-data-mono text-on-surface">{bankRecon.total}</span> Общо</span>
            </div>
          </div>
          <a href="/reconciliation" className="btn-ghost shrink-0 font-label-caps text-label-caps flex items-center gap-2">
            <span>УПРАВЛЯВАЙ</span>
            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
          </a>
        </section>

        {/* ── VAT CARDS ──────────────────────────────────────────────────────── */}
        {vat && (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
            <div className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/8">
              <p className="font-label-caps text-[10px] text-on-surface-variant/60 mb-4 tracking-[0.14em]">{t('dash.outVat')}</p>
              <p className="font-display text-[36px] leading-none italic text-on-surface">
                {(vat.outputVat / 1.95583).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} <span className="text-[16px] text-on-surface-variant/40">EUR</span>
              </p>
              <p className="font-label-caps text-[9px] text-on-surface-variant/40 mt-3">Изходящ ДДС · {periodLabel}</p>
            </div>
            <div className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/8">
              <p className="font-label-caps text-[10px] text-on-surface-variant/60 mb-4 tracking-[0.14em]">{t('dash.inVat')}</p>
              <p className="font-display text-[36px] leading-none italic text-on-surface">
                {(vat.estimatedInputVat / 1.95583).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} <span className="text-[16px] text-on-surface-variant/40">EUR</span>
              </p>
              <p className="font-label-caps text-[9px] text-on-surface-variant/40 mt-3">Входящ ДДС · {periodLabel}</p>
            </div>
            <div className="bg-surface-container-low p-6 rounded-xl border border-outline-variant/8">
              <p className="font-label-caps text-[10px] text-on-surface-variant/60 mb-4 tracking-[0.14em]">{t('dash.netVat')}</p>
              <p className={`font-display text-[36px] leading-none italic ${vat.netVat >= 0 ? 'text-error' : 'text-primary'}`}>
                {(vat.netVat / 1.95583).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} <span className="text-[16px] text-on-surface-variant/40">EUR</span>
              </p>
              {vat.pendingCredit > 0 && (
                <p className="font-label-caps text-[9px] text-on-surface-variant/50 mt-3">
                  {t('dash.potentialCredit')}: {(vat.pendingCredit / 1.95583).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} EUR
                </p>
              )}
              <p className="font-label-caps text-[9px] text-on-surface-variant/40 mt-1">Нет ДДС позиция · {periodLabel}</p>
            </div>
          </section>
        )}

        {/* ── REVENUE CHART + RECENT INVOICES ────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
          <div className="lg:col-span-2 bg-surface-container-low p-8 rounded-xl border border-outline-variant/8">
            <div className="flex items-center justify-between mb-8">
              <h3 className="font-label-caps text-[10px] text-on-surface-variant/60 tracking-[0.14em]">{t('dash.revenueByMonth')}</h3>
              <span className="font-label-caps text-[9px] text-on-surface-variant/40 bg-surface-container-high px-2 py-1 rounded">Период: {year} г.</span>
            </div>
            <RevenueChart data={data?.revenueByMonth || []} />
          </div>
          <div className="bg-surface-container-low p-8 rounded-xl border border-outline-variant/8">
            <h3 className="font-label-caps text-[10px] text-on-surface-variant/60 mb-8 tracking-[0.14em]">{t('dash.recentInvoices')}</h3>
            <div className="space-y-3">
              {(data?.recentInvoices || []).slice(0, 6).map((inv: any) => (
                <div key={inv.id} className="flex justify-between items-center py-3 border-b border-outline-variant/5 group/inv hover:bg-surface-container-high -mx-2 px-2 transition-colors">
                  <div>
                    <p className="font-body-sm text-on-surface truncate max-w-[140px] text-[13px]">{inv.clientName || inv.number}</p>
                    <p className="font-label-caps text-[9px] text-on-surface-variant/60 mt-0.5">{inv.number}</p>
                  </div>
                  <span className="font-data-mono text-data-mono text-on-surface">
                    {(parseFloat(inv.total || 0) / 1.95583).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} €
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FEATURED PROJECTS (Visual Gallery) ─────────────────────────────── */}
        <section>
          <div className="flex justify-between items-center mb-6">
            <div>
              <p className="font-label-caps text-label-caps text-primary mb-1">PROJECT PORTFOLIO</p>
              <h3 className="font-headline text-headline-md text-on-surface">{t('dash.activeProjects')}</h3>
            </div>
            <a href="/projects" className="btn-ghost flex items-center gap-2">
              <span>{t('dash.viewAll')}</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </a>
          </div>
          <div className="grid grid-cols-3 gap-gutter">
            {(projList.length > 0 ? projList : [{code:'—', name:'Sofia Penthouse'},{code:'—', name:'Luminavera Showroom'},{code:'—', name:'Coastal Villa'}]).map((proj: any, i: number) => (
              <a key={proj.id || i} href={proj.id ? `/projects/${proj.id}` : '/projects'} className="group relative overflow-hidden rounded-xl border border-outline-variant/8 hover:border-primary-container/20 hover:shadow-[0_8px_32px_rgba(0,0,0,0.4)] transition-all duration-300 cursor-pointer block">
                <img
                  src={PROJ_IMG_POOL[i % PROJ_IMG_POOL.length]}
                  alt={proj.name}
                  className="w-full h-52 object-cover transition-transform duration-700 group-hover:scale-108"
                  style={{ filter: 'brightness(0.65) saturate(0.85)' }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background/95 via-background/20 to-transparent" />
                <div className="absolute inset-0 rounded-xl border border-primary-container/0 group-hover:border-primary-container/30 transition-colors" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <p className="font-label-caps text-[9px] text-primary/70 mb-1 tracking-[0.2em]">{t('dash.activeProject')}</p>
                  <p className="font-label-caps text-[11px] text-on-surface leading-snug">{proj.code !== '—' ? `${proj.code} — ` : ''}{proj.name}</p>
                  {proj.client?.name && (
                    <p className="font-label-caps text-[9px] text-on-surface-variant/50 mt-0.5 truncate">{proj.client.name}</p>
                  )}
                </div>
                <div className="absolute top-3 right-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary-container shadow-[0_0_6px_rgba(62,144,255,0.8)] animate-pulse" />
                </div>
              </a>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen animate-pulse">
      <div className="h-72 bg-surface-container" />
      <div className="p-container-padding space-y-section-gap">
        <div className="grid grid-cols-3 gap-gutter">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-36 bg-surface-container-low rounded-xl border border-outline-variant/8" />
          ))}
        </div>
        <div className="grid grid-cols-12 gap-gutter">
          <div className="col-span-8 h-72 bg-surface-container-low rounded-xl border border-outline-variant/8" />
          <div className="col-span-4 h-72 bg-surface-container-high rounded-xl border border-outline-variant/8" />
        </div>
      </div>
    </div>
  );
}