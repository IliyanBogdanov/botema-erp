'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { RevenueChart } from '@/components/RevenueChart';
import { useState } from 'react';

// Premium Unsplash interiors — stable CDN URLs
const HERO_IMG     = 'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1600&auto=format&q=80';
const PROJ_IMGS    = [
  'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=600&auto=format&q=75',
  'https://images.unsplash.com/photo-1600210492493-0946911123ea?w=600&auto=format&q=75',
  'https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=600&auto=format&q=75',
];
const PROJ_LABELS  = ['1717.001 — Sofia Penthouse', '1717.002 — Luminavera Showroom', '1717.003 — Coastal Villa'];

export default function DashboardPage() {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', year],
    queryFn: () => api.get(`/dashboard?year=${year}`).then(r => r.data),
  });
  const { data: pendingDocs = [] } = useQuery({
    queryKey: ['pending-docs'],
    queryFn: () => api.get('/gmail/pending').then(r => r.data),
    refetchInterval: 30000,
  });
  const { data: alertsList = [] } = useQuery({
    queryKey: ['dashboard-alerts'],
    queryFn: () => api.get('/alerts?status=ACTIVE&limit=5').then(r => r.data),
    refetchInterval: 60000,
  });
  const { data: vat } = useQuery({
    queryKey: ['vat-overview', year],
    queryFn: () => api.get(`/vat/overview?year=${year}`).then(r => r.data),
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ['top-suppliers-dash'],
    queryFn: () => api.get('/purchases?limit=100').then(r => r.data),
  });

  if (isLoading) return <LoadingSkeleton />;

  const kpis   = data?.kpis || {};
  const margin = parseFloat(kpis.grossMargin || 0);

  const supplierMap: Record<string, number> = {};
  (Array.isArray(purchases) ? purchases : purchases.data || []).forEach((p: any) => {
    const name   = p.supplier?.name || p.supplierName || 'Unknown';
    const amount = parseFloat(p.amount || 0);
    if (amount > 0) supplierMap[name] = (supplierMap[name] || 0) + amount;
  });
  const topSuppliers = Object.entries(supplierMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxSupplier  = topSuppliers[0]?.[1] || 1;
  const barOpacity   = [1, 0.8, 0.6, 0.4, 0.25];

  return (
    <div className="min-h-screen">

      {/* ── HERO BANNER ─────────────────────────────────────────────────────── */}
      <div className="relative h-56 overflow-hidden">
        <img
          src={HERO_IMG}
          alt="Studio Botema interior"
          className="w-full h-full object-cover object-center scale-105"
          style={{ filter: 'brightness(0.45) saturate(0.8)' }}
        />
        {/* gradient: left = solid surface, right = transparent so image bleeds */}
        <div className="absolute inset-0 bg-gradient-to-r from-surface/95 via-surface/60 to-transparent" />
        {/* subtle blue glow in top-right */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-primary-container/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />

        {/* overlaid text */}
        <div className="absolute inset-0 flex flex-col justify-end p-container-padding pb-8">
          <p className="font-label-caps text-label-caps text-primary mb-2 tracking-widest">OPERATIONAL OVERVIEW</p>
          <h2 className="font-headline text-headline-lg text-on-surface">Executive Dashboard</h2>
          <p className="font-label-caps text-[10px] text-on-surface-variant/60 mt-2 tracking-widest">
            Studio Botema ЕООД · {year}
          </p>
        </div>

        {/* year + export row pinned bottom-right of hero */}
        <div className="absolute bottom-6 right-container-padding flex gap-3">
          <div className="flex gap-1 border border-outline-variant/30 bg-surface/60 backdrop-blur-sm p-1">
            {[2024, 2025, 2026].map(y => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                  year === y
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
          <button className="btn-secondary bg-surface/60 backdrop-blur-sm">EXPORT REPORT</button>
        </div>
      </div>

      <div className="p-container-padding space-y-section-gap">

        {/* ── ALERT BANNERS ──────────────────────────────────────────────────── */}
        {(Array.isArray(alertsList) ? alertsList : []).length > 0 && (
          <div className="bg-surface-container-low border border-error/20 border-l-4 border-l-error p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-error">warning</span>
              <div>
                <div className="font-label-caps text-label-caps text-on-surface">{alertsList.length} ACTIVE ALERTS</div>
                <div className="text-body-sm text-on-surface-variant mt-0.5 truncate max-w-xl">
                  {(alertsList as any[])[0]?.title}
                </div>
              </div>
            </div>
            <a href="/alerts" className="font-label-caps text-label-caps text-primary hover:opacity-80">VIEW ALL →</a>
          </div>
        )}
        {(Array.isArray(pendingDocs) ? pendingDocs : []).length > 0 && (
          <div className="bg-surface-container-low border border-outline-variant/10 border-l-4 border-l-primary-container p-4 flex items-center justify-between -mt-8">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-primary-container animate-pulse" />
              <span className="font-label-caps text-label-caps text-on-surface">
                {pendingDocs.length} DOCUMENT{pendingDocs.length > 1 ? 'S' : ''} PENDING REVIEW
              </span>
            </div>
            <a href="/documents" className="font-label-caps text-label-caps text-primary hover:opacity-80">REVIEW →</a>
          </div>
        )}

        {/* ── KPI CARDS ──────────────────────────────────────────────────────── */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
          {/* EUR */}
          <div className="bg-surface-container-low p-6 border border-outline-variant/10 relative overflow-hidden group hover:border-primary-container/30 transition-colors">
            <div className="absolute top-0 right-0 w-32 h-32 bg-primary-container/8 rounded-bl-full translate-x-10 -translate-y-10 group-hover:scale-110 transition-transform duration-500" />
            <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-primary-container shadow-[0_0_8px_rgba(62,144,255,0.5)]" />
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">TOTAL TURNOVER (EUR)</p>
            <div className="flex items-baseline gap-2">
              <span className="font-headline text-headline-xl text-on-surface">304,501</span>
              <span className="font-data-mono text-data-mono text-primary">EUR</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-primary">
              <span className="material-symbols-outlined text-[16px]">trending_up</span>
              <span className="font-label-caps text-[10px]">ALL CURRENCIES COMBINED</span>
            </div>
          </div>

          {/* BGN */}
          <div className="bg-surface-container-low p-6 border border-outline-variant/10 relative overflow-hidden hover:border-outline-variant/20 transition-colors">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">REVENUE (BGN)</p>
            <div className="flex items-baseline gap-2">
              <span className="font-headline text-headline-xl text-on-surface">
                {(kpis.revenue || 0).toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
              </span>
              <span className="font-data-mono text-data-mono text-secondary-fixed-dim">BGN</span>
            </div>
            <div className="mt-4 h-1.5 bg-surface-variant/30 overflow-hidden">
              <div className="h-full bg-primary-container w-[60%] transition-all duration-700" />
            </div>
          </div>

          {/* Margin */}
          <div className="bg-surface-container-low p-6 border border-outline-variant/10 relative overflow-hidden hover:border-outline-variant/20 transition-colors">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">GROSS MARGIN</p>
            <div className="flex items-baseline gap-2">
              <span className="font-headline text-headline-xl text-on-surface">{margin || '—'}%</span>
            </div>
            <div className="mt-4 flex items-center gap-2 text-on-surface-variant/60">
              <span className="material-symbols-outlined text-[16px]">analytics</span>
              <span className="font-label-caps text-[10px]">{kpis.invoiceCount || 0} INVOICES</span>
            </div>
          </div>
        </section>

        {/* ── BENTO GRID (Suppliers + AI Docs) ──────────────────────────────── */}
        <section className="grid grid-cols-12 gap-gutter">

          {/* Top Suppliers — col 8 */}
          <div className="col-span-12 lg:col-span-8 bg-surface-container-low p-8 border border-outline-variant/10">
            <div className="flex justify-between items-center mb-10">
              <h3 className="font-label-caps text-label-caps text-on-surface">TOP PROCUREMENT SUPPLIERS</h3>
              <span className="font-data-mono text-data-mono text-on-surface-variant">{topSuppliers.length} suppliers</span>
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
                <p className="text-on-surface-variant font-body-sm text-body-sm opacity-60">No purchase data yet.</p>
              )}
            </div>

            {/* Stats row */}
            <div className="mt-10 grid grid-cols-4 border-t border-outline-variant/10 pt-6 gap-4">
              <div className="text-center">
                <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">TOTAL PURCHASES</p>
                <p className="font-data-mono text-on-surface text-lg">
                  {Array.isArray(purchases) ? purchases.length : (purchases.data?.length ?? 0)}
                </p>
              </div>
              <div className="text-center">
                <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">ACTIVE SUPPLIERS</p>
                <p className="font-data-mono text-on-surface text-lg">{topSuppliers.length}</p>
              </div>
              <div className="text-center">
                <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">TOTAL COST</p>
                <p className="font-data-mono text-primary text-lg">
                  {topSuppliers.reduce((s, [, v]) => s + v, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} EUR
                </p>
              </div>
              <div className="text-center">
                <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">INVOICES</p>
                <p className="font-data-mono text-on-surface text-lg">{kpis.invoiceCount || '—'}</p>
              </div>
            </div>
          </div>

          {/* AI Document Center — col 4 */}
          <div className="col-span-12 lg:col-span-4 bg-surface-container-high p-8 border border-outline-variant/10 relative overflow-hidden">
            {/* accent glow */}
            <div className="absolute top-0 right-0 w-40 h-40 bg-primary-container/6 rounded-full blur-2xl pointer-events-none" />
            <div className="flex items-center gap-2 mb-8 relative">
              <span className="material-symbols-outlined text-primary">auto_awesome</span>
              <h3 className="font-label-caps text-label-caps text-on-surface">AI DOCUMENT CENTER</h3>
            </div>
            <div className="space-y-5 relative">
              {(Array.isArray(pendingDocs) ? pendingDocs : []).slice(0, 4).map((doc: any) => (
                <div key={doc.id} className="flex items-start gap-4 pb-5 border-b border-outline-variant/5 last:border-0 last:pb-0">
                  <div className="w-10 h-10 bg-primary-container/10 border border-primary-container/20 flex items-center justify-center flex-shrink-0">
                    <span className="material-symbols-outlined text-primary text-[18px]">description</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <p className="font-body-sm text-on-surface truncate text-[13px]">{doc.subject || doc.fileName || 'Document'}</p>
                    <p className="font-label-caps text-[9px] text-on-surface-variant/60 mt-0.5 truncate">{doc.senderEmail || ''}</p>
                    <div className="mt-2">
                      <span className="px-2 py-0.5 bg-primary-container/15 text-primary font-label-caps text-[8px] border border-primary-container/20">
                        PENDING REVIEW
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {(Array.isArray(pendingDocs) ? pendingDocs : []).length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center opacity-50">
                  <span className="material-symbols-outlined text-on-surface-variant text-4xl mb-3">check_circle</span>
                  <p className="font-label-caps text-label-caps text-on-surface-variant">ALL CLEAR</p>
                </div>
              )}
            </div>
            <a href="/documents" className="block w-full mt-8 py-3 border border-outline-variant/20 font-label-caps text-label-caps text-center text-on-surface-variant hover:bg-surface-variant/10 transition-colors relative">
              VIEW ALL QUEUE
            </a>
          </div>
        </section>

        {/* ── VAT CARDS ──────────────────────────────────────────────────────── */}
        {vat && (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
            <div className="bg-surface-container-low p-6 border border-outline-variant/10">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">OUTGOING VAT</p>
              <p className="font-headline text-headline-md text-on-surface">
                {vat.outputVat.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN
              </p>
            </div>
            <div className="bg-surface-container-low p-6 border border-outline-variant/10">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">INPUT VAT</p>
              <p className="font-headline text-headline-md text-on-surface">
                {vat.estimatedInputVat.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN
              </p>
            </div>
            <div className="bg-surface-container-low p-6 border border-outline-variant/10">
              <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">NET VAT POSITION</p>
              <p className={`font-headline text-headline-md ${vat.netVat >= 0 ? 'text-error' : 'text-primary'}`}>
                {vat.netVat.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN
              </p>
              {vat.pendingCredit > 0 && (
                <p className="font-label-caps text-[10px] text-on-surface-variant/60 mt-2">
                  POTENTIAL CREDIT: {vat.pendingCredit.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN
                </p>
              )}
            </div>
          </section>
        )}

        {/* ── REVENUE CHART + RECENT INVOICES ────────────────────────────────── */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
          <div className="lg:col-span-2 bg-surface-container-low p-8 border border-outline-variant/10">
            <h3 className="font-label-caps text-label-caps text-on-surface mb-8">REVENUE BY MONTH</h3>
            <RevenueChart data={data?.revenueByMonth || []} />
          </div>
          <div className="bg-surface-container-low p-8 border border-outline-variant/10">
            <h3 className="font-label-caps text-label-caps text-on-surface mb-8">RECENT INVOICES</h3>
            <div className="space-y-3">
              {(data?.recentInvoices || []).slice(0, 6).map((inv: any) => (
                <div key={inv.id} className="flex justify-between items-center py-3 border-b border-outline-variant/5 group/inv hover:bg-surface-container-high -mx-2 px-2 transition-colors">
                  <div>
                    <p className="font-body-sm text-on-surface truncate max-w-[140px] text-[13px]">{inv.clientName || inv.number}</p>
                    <p className="font-label-caps text-[9px] text-on-surface-variant/60 mt-0.5">{inv.number}</p>
                  </div>
                  <span className="font-data-mono text-data-mono text-on-surface">
                    {parseFloat(inv.total || 0).toLocaleString()} BGN
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
              <h3 className="font-headline text-headline-md text-on-surface">Active Design Projects</h3>
            </div>
            <a href="/projects" className="btn-ghost flex items-center gap-2">
              <span>VIEW ALL</span>
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </a>
          </div>
          <div className="grid grid-cols-3 gap-gutter">
            {PROJ_IMGS.map((img, i) => (
              <div key={i} className="group relative overflow-hidden border border-outline-variant/10 hover:border-primary-container/30 transition-colors cursor-pointer">
                <img
                  src={img}
                  alt={PROJ_LABELS[i]}
                  className="w-full h-48 object-cover transition-transform duration-700 group-hover:scale-105"
                  style={{ filter: 'brightness(0.7) saturate(0.9)' }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-surface/90 via-surface/20 to-transparent" />
                {/* hover glow */}
                <div className="absolute inset-0 border border-primary-container/0 group-hover:border-primary-container/40 transition-colors" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <p className="font-label-caps text-[9px] text-primary mb-1 tracking-widest">ACTIVE PROJECT</p>
                  <p className="font-label-caps text-label-caps text-on-surface">{PROJ_LABELS[i]}</p>
                </div>
                <div className="absolute top-3 right-3">
                  <div className="w-2 h-2 rounded-full bg-primary-container shadow-[0_0_8px_rgba(62,144,255,0.8)] animate-pulse" />
                </div>
              </div>
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
      <div className="h-56 bg-surface-container" />
      <div className="p-container-padding space-y-section-gap">
        <div className="grid grid-cols-3 gap-gutter">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 bg-surface-container-low border border-outline-variant/10" />
          ))}
        </div>
        <div className="grid grid-cols-12 gap-gutter">
          <div className="col-span-8 h-72 bg-surface-container-low border border-outline-variant/10" />
          <div className="col-span-4 h-72 bg-surface-container-high border border-outline-variant/10" />
        </div>
      </div>
    </div>
  );
}