'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, fmt, fmtDate, statusConfig } from '@/lib/api';

const PROJ_IMGS = [
  'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1200&auto=format&q=80',
  'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1200&auto=format&q=80',
  'https://images.unsplash.com/photo-1600210492493-0946911123ea?w=1200&auto=format&q=80',
  'https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=1200&auto=format&q=80',
];
function getImg(code: string) {
  const n = code ? code.split('').reduce((s, c) => s + c.charCodeAt(0), 0) : 0;
  return PROJ_IMGS[n % PROJ_IMGS.length];
}

function StatusChip({ status }: { status: string }) {
  const cfg = statusConfig[status] || { label: status };
  const label = cfg.label.replace(/^[^A-Za-zА-Яа-я0-9]+/, '').trim();
  const colorMap: Record<string, string> = {
    ACTIVE: 'bg-primary-container/20 text-primary border-primary-container/30',
    COMPLETED: 'bg-surface-container text-on-surface-variant border-outline-variant/20',
    ON_HOLD: 'bg-warning/10 text-warning border-warning/30',
    PAID: 'bg-primary-container/20 text-primary border-primary-container/30',
    OVERDUE: 'bg-error/10 text-error border-error/30',
    PENDING: 'bg-surface-container-high text-on-surface-variant border-outline-variant/20',
    CANCELLED: 'bg-error/5 text-error/60 border-error/20',
  };
  return (
    <span className={`inline-flex items-center border px-2 py-0.5 font-label-caps text-[9px] ${colorMap[status] || 'bg-surface-container text-on-surface-variant border-outline-variant/20'}`}>
      {label}
    </span>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<'invoices' | 'purchases' | 'inventory'>('invoices');

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get(`/projects/${id}`).then(r => r.data),
    enabled: !!id,
  });

  if (isLoading) return (
    <div className="p-8 space-y-4 animate-pulse">
      <div className="h-48 bg-surface-container-low border border-outline-variant/10" />
      <div className="grid grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-surface-container-low border border-outline-variant/10" />)}
      </div>
    </div>
  );
  if (!project) return <div className="p-8 text-error">Проектът не е намерен.</div>;

  const totalRevenue = project.totalRevenue || 0;
  const totalCosts = project.totalCosts || 0;
  const margin = totalRevenue - totalCosts;
  const invoices = project.invoices || [];
  const purchases = project.purchases || [];
  const inventory = project.inventory || [];

  return (
    <div className="min-h-screen">
      {/* HERO */}
      <div className="relative h-48 overflow-hidden">
        <img src={getImg(project.code || '')} alt={project.name}
          className="w-full h-full object-cover" style={{ filter: 'brightness(0.35) saturate(0.7)' }} />
        <div className="absolute inset-0 bg-gradient-to-r from-surface/95 via-surface/70 to-transparent" />
        <div className="absolute inset-0 px-8 flex flex-col justify-center gap-2">
          <button onClick={() => router.back()}
            className="flex items-center gap-1 text-on-surface-variant/70 hover:text-primary transition-colors w-fit font-body-sm text-body-sm">
            <span className="material-symbols-outlined text-[16px]">arrow_back</span>
            Обратно към проектите
          </button>
          <div className="flex items-center gap-3">
            <p className="font-label-caps text-label-caps text-primary">{project.code}</p>
            <StatusChip status={project.status} />
            <span className="font-label-caps text-label-caps text-on-surface-variant/50">{project.year}</span>
          </div>
          <h1 className="font-headline text-headline-lg text-on-surface">{project.name}</h1>
          {project.client && <p className="font-body-sm text-body-sm text-on-surface-variant">{project.client.name}</p>}
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* KPI CARDS */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { icon: 'trending_up', label: 'ПРИХОДИ', val: fmt(totalRevenue, 'BGN'), sub: `${invoices.length} фактури`, accent: totalRevenue > 0 },
            { icon: 'shopping_cart', label: 'РАЗХОДИ', val: fmt(totalCosts, 'BGN'), sub: `${purchases.length} покупки` },
            { icon: 'percent', label: 'МАРЖ', val: totalRevenue > 0 ? ((margin / totalRevenue) * 100).toFixed(1) + '%' : '—', sub: fmt(margin, 'BGN') },
            { icon: 'inventory_2', label: 'СКЛАД', val: String(inventory.length), sub: 'движения' },
          ].map(c => (
            <div key={c.label} className={`border p-4 flex flex-col gap-2 ${c.accent ? 'border-primary-container/40 bg-primary-container/5' : 'border-outline-variant/10 bg-surface-container-low'}`}>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-primary">{c.icon}</span>
                <p className="font-label-caps text-label-caps text-on-surface-variant">{c.label}</p>
              </div>
              <p className={`font-headline text-headline-sm ${c.accent ? 'text-primary' : 'text-on-surface'}`}>{c.val}</p>
              <p className="font-body-sm text-body-sm text-on-surface-variant">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* TABS */}
        <div className="border border-outline-variant/10 bg-surface-container-low">
          <div className="flex border-b border-outline-variant/10">
            {(['invoices', 'purchases', 'inventory'] as const).map(t => {
              const labels = { invoices: 'Фактури', purchases: 'Доставки', inventory: 'Склад' };
              const counts = { invoices: invoices.length, purchases: purchases.length, inventory: inventory.length };
              return (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-5 py-3 font-label-caps text-label-caps transition-colors border-b-2 -mb-px ${tab === t ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}>
                  {labels[t]}
                  <span className="ml-2 text-[9px] opacity-60">{counts[t]}</span>
                </button>
              );
            })}
          </div>

          <div className="overflow-x-auto">
            {tab === 'invoices' && (
              <table className="w-full">
                <thead><tr>
                  {['ФАКТУРА', 'ДАТА', 'КЛИЕНТ', 'НЕТО', 'ОБЩО', 'СТАТУС'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {invoices.length === 0
                    ? <tr><td colSpan={6} className="table-cell text-center text-on-surface-variant/40 py-8">Няма фактури</td></tr>
                    : invoices.map((inv: any) => (
                      <tr key={inv.id} className="hover:bg-surface-container transition-colors">
                        <td className="table-cell font-mono text-xs text-on-surface-variant">{inv.number}</td>
                        <td className="table-cell text-on-surface-variant">{fmtDate(inv.date)}</td>
                        <td className="table-cell font-medium text-on-surface">{inv.client?.name || '—'}</td>
                        <td className="table-cell text-right text-on-surface-variant">{fmt(inv.amountNet, inv.currency)}</td>
                        <td className="table-cell text-right font-semibold text-on-surface">{fmt(inv.amountTotal, inv.currency)}</td>
                        <td className="table-cell"><StatusChip status={inv.status} /></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            {tab === 'purchases' && (
              <table className="w-full">
                <thead><tr>
                  {['ДАТА', 'ДОСТАВЧИК', 'ФАКТУРА №', 'СУМА', 'ОПИСАНИЕ'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {purchases.length === 0
                    ? <tr><td colSpan={5} className="table-cell text-center text-on-surface-variant/40 py-8">Няма доставки</td></tr>
                    : purchases.map((p: any) => (
                      <tr key={p.id} className="hover:bg-surface-container transition-colors">
                        <td className="table-cell text-on-surface-variant">{fmtDate(p.date)}</td>
                        <td className="table-cell font-medium text-on-surface">{p.supplier?.name || '—'}</td>
                        <td className="table-cell font-mono text-xs text-on-surface-variant">{p.invoiceNumber || p.invoiceNo || '—'}</td>
                        <td className="table-cell text-right font-semibold text-on-surface">{fmt(p.amount, p.currency)}</td>
                        <td className="table-cell text-on-surface-variant/60 truncate max-w-[200px]">{p.description || '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            {tab === 'inventory' && (
              <table className="w-full">
                <thead><tr>
                  {['КОД', 'АРТИКУЛ', 'КАТЕГОРИЯ', 'ПОСТЪПИЛО', 'ИЗПИСАНО', 'НАЛИЧНО'].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {inventory.length === 0
                    ? <tr><td colSpan={6} className="table-cell text-center text-on-surface-variant/40 py-8">Няма артикули</td></tr>
                    : inventory.map((item: any) => (
                      <tr key={item.id} className="hover:bg-surface-container transition-colors">
                        <td className="table-cell font-mono text-xs text-on-surface-variant">{item.code}</td>
                        <td className="table-cell font-medium text-on-surface">{item.name}</td>
                        <td className="table-cell text-on-surface-variant/60 text-xs">{item.category}</td>
                        <td className="table-cell text-right text-primary">{item.qtyIn ?? '—'}</td>
                        <td className="table-cell text-right text-error">{item.qtyOut ?? '—'}</td>
                        <td className="table-cell text-right font-semibold text-on-surface">{item.qtyBalance ?? '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {project.notes && (
          <div className="border border-outline-variant/10 bg-surface-container-low p-5">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-3">БЕЛЕЖКИ</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-wrap">{project.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
