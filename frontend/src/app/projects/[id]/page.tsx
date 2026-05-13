'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { api, fmt, fmtBgn, fmtDate, statusConfig } from '@/lib/api';

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

// ─── Timeline helpers ─────────────────────────────────────────────────────────

const DOC_TYPE_LABELS: Record<string, string> = {
  OFFER_OUT: 'Оферта', OFFER_IN: 'Оферта (вх.)', PROFORMA: 'Проформа',
  INVOICE: 'Фактура', INVOICE_IN: 'Фактура (вх.)', CREDIT_NOTE: 'Кредитно известие',
  ADVANCE: 'Аванс', PROTOCOL: 'Протокол', DELIVERY_NOTE: 'Доставъчна бележка',
  CONTRACT: 'Договор', WARRANTY: 'Гаранция', OTHER: 'Друго',
};

const DOC_TYPE_ICON: Record<string, string> = {
  OFFER_OUT: 'description', PROFORMA: 'receipt_long', ADVANCE: 'payments',
  INVOICE: 'receipt', PROTOCOL: 'assignment_turned_in', DELIVERY_NOTE: 'local_shipping',
  WARRANTY: 'verified', CONTRACT: 'handshake', OTHER: 'article',
};

const DOC_TYPE_COLOR: Record<string, string> = {
  OFFER_OUT: 'text-on-surface-variant border-outline-variant/40 bg-surface-container',
  PROFORMA: 'text-primary border-primary-container/40 bg-primary-container/10',
  ADVANCE: 'text-warning border-warning/30 bg-warning/5',
  INVOICE: 'text-primary border-primary-container/40 bg-primary-container/10',
  PROTOCOL: 'text-on-surface-variant border-outline-variant/40 bg-surface-container',
  DELIVERY_NOTE: 'text-on-surface-variant border-outline-variant/40 bg-surface-container',
  WARRANTY: 'text-on-surface-variant border-outline-variant/40 bg-surface-container',
};

const ORDER_TYPE_LABELS: Record<string, string> = {
  PURCHASE_ORDER: 'Поръчка на стока', SALES_ORDER: 'Продажбена поръчка',
  INTERNAL: 'Вътрешна поръчка',
};

function TimelineSection({ title, icon, color, children }: {
  title: string; icon: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center border ${color} flex-shrink-0`}>
          <span className="material-symbols-outlined text-[15px]">{icon}</span>
        </div>
        <div className="flex-1 w-px bg-outline-variant/20 mt-1" />
      </div>
      <div className="flex-1 pb-6">
        <p className="font-label-caps text-label-caps text-on-surface-variant mb-2">{title}</p>
        {children}
      </div>
    </div>
  );
}

function TimelineTab({ project }: { project: any }) {
  const bizDocs = (project.bizDocuments || []) as any[];
  const orders = (project.orders || []) as any[];
  const invoices = (project.invoices || []) as any[];
  const payments = (project.payments || []) as any[];

  const offers = bizDocs.filter((d: any) => d.docType === 'OFFER_OUT');
  const proformas = bizDocs.filter((d: any) => d.docType === 'PROFORMA');
  const advances = bizDocs.filter((d: any) => d.docType === 'ADVANCE');
  const protocols = bizDocs.filter((d: any) => ['PROTOCOL', 'DELIVERY_NOTE'].includes(d.docType));

  const isEmpty = !offers.length && !proformas.length && !advances.length && !orders.length
    && !protocols.length && !invoices.length && !payments.length;

  if (isEmpty) {
    return (
      <div className="p-8 text-center text-on-surface-variant/40 font-body-sm">
        Няма свързани документи за бизнес цикъл
      </div>
    );
  }

  return (
    <div className="p-5">
      {offers.length > 0 && (
        <TimelineSection title="ОФЕРТА" icon="description" color="border-outline-variant/40 text-on-surface-variant bg-surface-container">
          {offers.map((d: any) => (
            <div key={d.id} className="border border-outline-variant/10 bg-surface-container-low p-3 mb-2 flex items-center justify-between">
              <div>
                <p className="font-body-sm text-body-sm text-on-surface">{d.docNumber || '—'}</p>
                <p className="text-[10px] text-on-surface-variant/60">{fmtDate(d.docDate)} · {d.counterparty?.name || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                {d.amountTotal > 0 && <span className="font-mono text-xs text-on-surface">{fmt(d.amountTotal, d.currency)}</span>}
                <StatusChip status={d.status} />
              </div>
            </div>
          ))}
        </TimelineSection>
      )}

      {proformas.length > 0 && (
        <TimelineSection title="ПРОФОРМА" icon="receipt_long" color="border-primary-container/40 text-primary bg-primary-container/10">
          {proformas.map((d: any) => (
            <div key={d.id} className="border border-outline-variant/10 bg-surface-container-low p-3 mb-2 flex items-center justify-between">
              <div>
                <p className="font-body-sm text-body-sm text-on-surface">{d.docNumber || '—'}</p>
                <p className="text-[10px] text-on-surface-variant/60">{fmtDate(d.docDate)} · {d.counterparty?.name || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                {d.amountTotal > 0 && <span className="font-mono text-xs text-on-surface">{fmt(d.amountTotal, d.currency)}</span>}
                <StatusChip status={d.status} />
              </div>
            </div>
          ))}
        </TimelineSection>
      )}

      {advances.length > 0 && (
        <TimelineSection title="АВАНС" icon="payments" color="border-warning/30 text-warning bg-warning/5">
          {advances.map((d: any) => (
            <div key={d.id} className="border border-outline-variant/10 bg-surface-container-low p-3 mb-2 flex items-center justify-between">
              <div>
                <p className="font-body-sm text-body-sm text-on-surface">{d.docNumber || '—'}</p>
                <p className="text-[10px] text-on-surface-variant/60">{fmtDate(d.docDate)} · {d.counterparty?.name || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                {d.amountTotal > 0 && <span className="font-mono text-xs text-on-surface">{fmt(d.amountTotal, d.currency)}</span>}
                <StatusChip status={d.status} />
              </div>
            </div>
          ))}
        </TimelineSection>
      )}

      {orders.length > 0 && (
        <TimelineSection title="ПОРЪЧКИ НА СТОКА" icon="shopping_cart" color="border-outline-variant/40 text-on-surface-variant bg-surface-container">
          {orders.map((o: any) => (
            <div key={o.id} className="border border-outline-variant/10 bg-surface-container-low p-3 mb-2">
              <div className="flex items-center justify-between mb-1">
                <div>
                  <p className="font-body-sm text-body-sm text-on-surface">{o.orderNumber || o.id.slice(-6)}</p>
                  <p className="text-[10px] text-on-surface-variant/60">
                    {fmtDate(o.orderDate)} · {ORDER_TYPE_LABELS[o.orderType] || o.orderType} · {o.counterparty?.name || '—'}
                  </p>
                </div>
                <StatusChip status={o.status} />
              </div>
              {o.deliveries?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {o.deliveries.map((d: any) => (
                    <div key={d.id} className="flex items-center gap-2 text-[10px] text-on-surface-variant/60">
                      <span className="material-symbols-outlined text-[12px]">local_shipping</span>
                      Доставка {fmtDate(d.deliveryDate)} · <StatusChip status={d.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </TimelineSection>
      )}

      {protocols.length > 0 && (
        <TimelineSection title="ПРОТОКОЛИ / ДОСТАВЪЧНИ БЕЛЕЖКИ" icon="assignment_turned_in" color="border-outline-variant/40 text-on-surface-variant bg-surface-container">
          {protocols.map((d: any) => (
            <div key={d.id} className="border border-outline-variant/10 bg-surface-container-low p-3 mb-2 flex items-center justify-between">
              <div>
                <p className="font-body-sm text-body-sm text-on-surface">{DOC_TYPE_LABELS[d.docType] || d.docType} — {d.docNumber || '—'}</p>
                <p className="text-[10px] text-on-surface-variant/60">{fmtDate(d.docDate)} · {d.counterparty?.name || '—'}</p>
              </div>
              <StatusChip status={d.status} />
            </div>
          ))}
        </TimelineSection>
      )}

      {invoices.length > 0 && (
        <TimelineSection title="ФАКТУРИ" icon="receipt" color="border-primary-container/40 text-primary bg-primary-container/10">
          {invoices.map((inv: any) => (
            <div key={inv.id} className="border border-outline-variant/10 bg-surface-container-low p-3 mb-2 flex items-center justify-between">
              <div>
                <p className="font-body-sm text-body-sm text-on-surface">{inv.number}</p>
                <p className="text-[10px] text-on-surface-variant/60">{fmtDate(inv.date)} · {inv.client?.name || '—'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-on-surface">{fmt(inv.amountTotal, inv.currency)}</span>
                <StatusChip status={inv.status} />
              </div>
            </div>
          ))}
        </TimelineSection>
      )}

      {payments.length > 0 && (
        <TimelineSection title="ПЛАЩАНИЯ" icon="account_balance" color="border-primary-container/40 text-primary bg-primary-container/10">
          {payments.map((p: any) => (
            <div key={p.id} className="border border-outline-variant/10 bg-surface-container-low p-3 mb-2 flex items-center justify-between">
              <div>
                <p className="font-body-sm text-body-sm text-on-surface">{p.counterpartyName || p.notes?.slice(0, 40) || '—'}</p>
                <p className="text-[10px] text-on-surface-variant/60">{fmtDate(p.paymentDate)}</p>
              </div>
              <span className="font-mono text-xs font-semibold text-primary">{fmt(p.amount, p.currency)}</span>
            </div>
          ))}
        </TimelineSection>
      )}
    </div>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<'timeline' | 'invoices' | 'purchases' | 'inventory'>('timeline');

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
            { icon: 'trending_up', label: 'ПРИХОДИ', val: fmtBgn(totalRevenue), sub: `${invoices.length} фактури`, accent: totalRevenue > 0 },
            { icon: 'shopping_cart', label: 'РАЗХОДИ', val: fmtBgn(totalCosts), sub: `${purchases.length} покупки` },
            { icon: 'percent', label: 'МАРЖ', val: totalRevenue > 0 ? ((margin / totalRevenue) * 100).toFixed(1) + '%' : '—', sub: fmtBgn(margin) },
            { icon: 'inventory_2', label: 'СКЛАД', val: String(inventory.length), sub: 'артикула' },
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
            {(['timeline', 'invoices', 'purchases', 'inventory'] as const).map(t => {
              const labels = { timeline: 'Бизнес цикъл', invoices: 'Фактури', purchases: 'Доставки', inventory: 'Склад' };
              const icons = { timeline: 'timeline', invoices: 'receipt', purchases: 'local_shipping', inventory: 'inventory_2' };
              const counts: Record<string, number> = {
                timeline: (project.bizDocuments?.length || 0) + (project.orders?.length || 0),
                invoices: invoices.length,
                purchases: purchases.length,
                inventory: inventory.length,
              };
              return (
                <button key={t} onClick={() => setTab(t)}
                  className={`px-5 py-3 font-label-caps text-label-caps transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${tab === t ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'}`}>
                  <span className="material-symbols-outlined text-[14px]">{icons[t]}</span>
                  {labels[t]}
                  <span className="ml-1 text-[9px] opacity-60">{counts[t] || ''}</span>
                </button>
              );
            })}
          </div>

          {tab === 'timeline' && <TimelineTab project={project} />}

          {tab !== 'timeline' && (
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
          )}
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
