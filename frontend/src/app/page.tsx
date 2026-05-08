'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { RevenueChart } from '@/components/RevenueChart';
import { useState } from 'react';

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

  // Build top suppliers from purchases
  const supplierMap: Record<string, number> = {};
  (Array.isArray(purchases) ? purchases : purchases.data || []).forEach((p: any) => {
    const name   = p.supplier?.name || p.supplierName || 'Unknown';
    const amount = parseFloat(p.amount || 0);
    if (amount > 0) supplierMap[name] = (supplierMap[name] || 0) + amount;
  });
  const topSuppliers = Object.entries(supplierMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const maxSupplier = topSuppliers[0]?.[1] || 1;

  return (
    <div className="p-container-padding space-y-section-gap min-h-screen">
      {/* Header */}
      <section className="flex justify-between items-end">
        <div>
          <p className="font-label-caps text-label-caps text-primary mb-2">OPERATIONAL OVERVIEW</p>
          <h2 className="font-headline text-headline-lg text-on-surface">Executive Dashboard</h2>
        </div>
        <div className="flex gap-4">
          <div className="flex gap-1 border border-outline-variant/20 p-1">
            {[2024, 2025, 2026].map(y => (
              <button key={y} onClick={() => setYear(y)}
                className={`px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                  year === y
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}>
                {y}
              </button>
            ))}
          </div>
          <button className="btn-secondary">EXPORT REPORT</button>
        </div>
      </section>

      {/* Alert banner */}
      {(Array.isArray(alertsList) ? alertsList : []).length > 0 && (
        <div className="bg-surface-container-low border border-error/20 border-l-4 border-l-error p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-error">warning</span>
            <div>
              <div className="font-label-caps text-label-caps text-on-surface">
                {alertsList.length} ACTIVE ALERTS
              </div>
              <div className="text-body-sm text-on-surface-variant mt-0.5 truncate max-w-xl">
                {(alertsList as any[])[0]?.title}
              </div>
            </div>
          </div>
          <a href="/alerts" className="font-label-caps text-label-caps text-primary hover:opacity-80">VIEW ALL →</a>
        </div>
      )}

      {(Array.isArray(pendingDocs) ? pendingDocs : []).length > 0 && (
        <div className="bg-surface-container-low border border-outline-variant/10 border-l-4 border-l-primary-container p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary-container animate-pulse" />
            <span className="font-label-caps text-label-caps text-on-surface">
              {pendingDocs.length} DOCUMENT{pendingDocs.length > 1 ? 'S' : ''} PENDING REVIEW
            </span>
          </div>
          <a href="/documents" className="font-label-caps text-label-caps text-primary hover:opacity-80">REVIEW →</a>
        </div>
      )}

      {/* KPI Cards */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-gutter">
        <div className="bg-surface-container-low p-6 border border-outline-variant/10 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary-container/5 rounded-bl-full translate-x-8 -translate-y-8 group-hover:scale-110 transition-transform duration-500" />
          <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">TOTAL TURNOVER (EUR)</p>
          <div className="flex items-baseline gap-2">
            <span className="font-headline text-headline-xl text-on-surface">
              {(304501).toLocaleString()}
            </span>
            <span className="font-data-mono text-data-mono text-primary">EUR</span>
          </div>
          <div className="mt-4 flex items-center gap-2 text-primary">
            <span className="material-symbols-outlined text-sm">trending_up</span>
            <span className="font-label-caps text-[10px]">ALL CURRENCIES COMBINED</span>
          </div>
        </div>

        <div className="bg-surface-container-low p-6 border border-outline-variant/10">
          <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">REVENUE (BGN)</p>
          <div className="flex items-baseline gap-2">
            <span className="font-headline text-headline-xl text-on-surface">
              {(kpis.revenue || 0).toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
            </span>
            <span className="font-data-mono text-data-mono text-secondary-fixed-dim">BGN</span>
          </div>
          <div className="mt-4 h-1 bg-surface-variant/30 overflow-hidden">
            <div className="h-full bg-primary-container w-[60%]" />
          </div>
        </div>

        <div className="bg-surface-container-low p-6 border border-outline-variant/10">
          <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">GROSS MARGIN</p>
          <div className="flex items-baseline gap-2">
            <span className="font-headline text-headline-xl text-on-surface">{margin}%</span>
          </div>
          <div className="mt-4 flex items-center gap-2 text-on-surface-variant/60">
            <span className="material-symbols-outlined text-sm">analytics</span>
            <span className="font-label-caps text-[10px]">{kpis.invoiceCount || 0} INVOICES</span>
          </div>
        </div>
      </section>

      {/* Bento Grid */}
      <section className="grid grid-cols-12 gap-gutter">
        {/* Top Suppliers */}
        <div className="col-span-12 lg:col-span-8 bg-surface-container-low p-8 border border-outline-variant/10">
          <div className="flex justify-between items-center mb-10">
            <h3 className="font-label-caps text-label-caps text-on-surface">TOP PROCUREMENT SUPPLIERS</h3>
            <span className="font-data-mono text-data-mono text-on-surface-variant">
              {topSuppliers.length} suppliers
            </span>
          </div>
          <div className="space-y-6">
            {topSuppliers.map(([name, amount]) => (
              <div key={name} className="space-y-2">
                <div className="flex justify-between font-label-caps text-[10px]">
                  <span className="text-on-surface uppercase">{name}</span>
                  <span className="text-primary font-data-mono">
                    {amount.toLocaleString(undefined, { maximumFractionDigits: 0 })} EUR
                  </span>
                </div>
                <div className="h-2 bg-surface-container-highest">
                  <div
                    className="h-full bg-primary-container transition-all duration-700"
                    style={{ width: `${Math.round((amount / maxSupplier) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {topSuppliers.length === 0 && (
              <p className="text-on-surface-variant font-body-sm text-body-sm">No purchase data yet.</p>
            )}
          </div>

          {/* Stats row */}
          <div className="mt-10 grid grid-cols-3 border-t border-outline-variant/10 pt-6 gap-4">
            <div className="text-center">
              <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">TOTAL PURCHASES</p>
              <p className="font-data-mono text-on-surface">{Array.isArray(purchases) ? purchases.length : (purchases.data?.length ?? 0)}</p>
            </div>
            <div className="text-center">
              <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">ACTIVE SUPPLIERS</p>
              <p className="font-data-mono text-on-surface">{topSuppliers.length}</p>
            </div>
            <div className="text-center">
              <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">TOTAL COST</p>
              <p className="font-data-mono text-primary">
                {topSuppliers.reduce((s, [, v]) => s + v, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} EUR
              </p>
            </div>
          </div>
        </div>

        {/* AI Doc Processing */}
        <div className="col-span-12 lg:col-span-4 bg-surface-container-high p-8 border border-outline-variant/10">
          <div className="flex items-center gap-2 mb-8">
            <span className="material-symbols-outlined text-primary">auto_awesome</span>
            <h3 className="font-label-caps text-label-caps text-on-surface">AI DOCUMENT CENTER</h3>
          </div>
          <div className="space-y-6">
            {(Array.isArray(pendingDocs) ? pendingDocs : []).slice(0, 4).map((doc: any) => (
              <div key={doc.id} className="flex items-start gap-4 pb-6 border-b border-outline-variant/5">
                <div className="w-10 h-10 bg-primary-container/10 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-primary text-xl">description</span>
                </div>
                <div className="flex-1 overflow-hidden">
                  <p className="font-body-sm text-on-surface truncate">{doc.subject || doc.fileName || 'Document'}</p>
                  <p className="font-label-caps text-[9px] text-on-surface-variant/60 mt-0.5">{doc.senderEmail || ''}</p>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="px-2 py-0.5 bg-primary-container/20 text-primary font-label-caps text-[8px]">
                      PENDING
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {(Array.isArray(pendingDocs) ? pendingDocs : []).length === 0 && (
              <div className="text-on-surface-variant font-body-sm text-body-sm opacity-60">
                No pending documents
              </div>
            )}
          </div>
          <a href="/documents" className="block w-full mt-8 py-3 border border-outline-variant/20 font-label-caps text-label-caps text-center text-on-surface-variant hover:bg-surface-variant/10 transition-colors">
            VIEW ALL QUEUE
          </a>
        </div>
      </section>

      {/* VAT & Revenue chart */}
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

      {/* Revenue chart */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter">
        <div className="lg:col-span-2 bg-surface-container-low p-8 border border-outline-variant/10">
          <h3 className="font-label-caps text-label-caps text-on-surface mb-8">REVENUE BY MONTH</h3>
          <RevenueChart data={data?.revenueByMonth || []} />
        </div>
        <div className="bg-surface-container-low p-8 border border-outline-variant/10">
          <h3 className="font-label-caps text-label-caps text-on-surface mb-8">RECENT INVOICES</h3>
          <div className="space-y-4">
            {(data?.recentInvoices || []).slice(0, 6).map((inv: any) => (
              <div key={inv.id} className="flex justify-between items-center py-3 border-b border-outline-variant/5">
                <div>
                  <p className="font-body-sm text-on-surface truncate max-w-[140px]">{inv.clientName || inv.number}</p>
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
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-container-padding space-y-section-gap animate-pulse">
      <div className="h-8 w-48 bg-surface-container rounded" />
      <div className="grid grid-cols-3 gap-gutter">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 bg-surface-container-low border border-outline-variant/10" />
        ))}
      </div>
      <div className="grid grid-cols-12 gap-gutter">
        <div className="col-span-8 h-64 bg-surface-container-low border border-outline-variant/10" />
        <div className="col-span-4 h-64 bg-surface-container-high border border-outline-variant/10" />
      </div>
    </div>
  );
}


