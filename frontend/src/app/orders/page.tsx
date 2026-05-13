'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';
import { Modal } from '@/components/Modal';

const ORDER_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  CLIENT_ORDER:   { label: 'От клиент', icon: 'groups', color: 'text-primary' },
  SUPPLIER_ORDER: { label: 'Към доставчик', icon: 'local_shipping', color: 'text-on-surface-variant' },
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT:       'border-outline-variant/30 text-on-surface-variant',
  CONFIRMED:   'border-primary/30 bg-primary/10 text-primary',
  IN_PROGRESS: 'border-warning/30 bg-warning/10 text-warning',
  DELIVERED:   'border-primary/30 bg-primary/10 text-primary',
  CANCELLED:   'border-error/30 bg-error/10 text-error',
  COMPLETED:   'border-outline-variant/20 text-on-surface-variant',
};

const labelClass = 'block font-label-caps text-label-caps text-on-surface-variant mb-1.5';

interface OrderLine {
  description: string;
  qty: number;
  unitPrice: number;
  unit: string;
}

function OrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    orderType: 'CLIENT_ORDER', status: 'DRAFT', currency: 'EUR',
    orderDate: new Date().toISOString().slice(0, 10),
    counterpartyId: '', projectId: '', notes: '',
  });
  const [lines, setLines] = useState<OrderLine[]>([{ description: '', qty: 1, unitPrice: 0, unit: 'бр' }]);
  const [error, setError] = useState('');

  const { data: counterparties = [] } = useQuery({
    queryKey: ['counterparties-list'],
    queryFn: () => api.get('/counterparties').then(r => r.data),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects').then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post('/orders', data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['orders'] }); onClose(); },
    onError: (e: any) => setError(e.response?.data?.error || 'Грешка'),
  });

  const handleSubmit = () => {
    if (!form.counterpartyId) return setError('Изберете контрагент');
    createMutation.mutate({ ...form, lines });
  };

  const updateLine = (i: number, field: keyof OrderLine, value: any) => {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  };

  return (
    <Modal open={open} onClose={onClose} title="Нова поръчка">
      <div className="space-y-4 min-w-[560px]">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>ТИП</label>
            <select value={form.orderType} onChange={e => setForm(f => ({ ...f, orderType: e.target.value }))}
              className="w-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm focus:outline-none focus:border-primary">
              <option value="CLIENT_ORDER">От клиент</option>
              <option value="SUPPLIER_ORDER">Към доставчик</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>ДАТА</label>
            <input type="date" value={form.orderDate} onChange={e => setForm(f => ({ ...f, orderDate: e.target.value }))}
              className="w-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm focus:outline-none focus:border-primary" />
          </div>
          <div>
            <label className={labelClass}>КОНТРАГЕНТ</label>
            <select value={form.counterpartyId} onChange={e => setForm(f => ({ ...f, counterpartyId: e.target.value }))}
              className="w-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm focus:outline-none focus:border-primary">
              <option value="">— Изберете —</option>
              {(counterparties as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>ПРОЕКТ</label>
            <select value={form.projectId} onChange={e => setForm(f => ({ ...f, projectId: e.target.value }))}
              className="w-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm focus:outline-none focus:border-primary">
              <option value="">— Без проект —</option>
              {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass}>ВАЛУТА</label>
            <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
              className="w-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm focus:outline-none focus:border-primary">
              <option value="BGN">BGN</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>СТАТУС</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className="w-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm focus:outline-none focus:border-primary">
              <option value="DRAFT">Чернова</option>
              <option value="CONFIRMED">Потвърдена</option>
              <option value="IN_PROGRESS">В процес</option>
            </select>
          </div>
        </div>

        <div>
          <label className={labelClass}>БЕЛЕЖКИ</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
            className="w-full border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm focus:outline-none focus:border-primary resize-none" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={labelClass}>РЕДОВЕ</label>
            <button onClick={() => setLines(l => [...l, { description: '', qty: 1, unitPrice: 0, unit: 'бр' }])}
              className="font-label-caps text-label-caps text-primary flex items-center gap-1 hover:opacity-70">
              <span className="material-symbols-outlined text-[14px]">add</span> Добави ред
            </button>
          </div>
          <div className="border border-outline-variant/10 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-container-high">
                  <th className="px-3 py-2 text-left font-label-caps text-[9px] text-on-surface-variant">ОПИСАНИЕ</th>
                  <th className="px-3 py-2 text-right font-label-caps text-[9px] text-on-surface-variant w-16">КОЛ.</th>
                  <th className="px-3 py-2 text-right font-label-caps text-[9px] text-on-surface-variant w-24">ЦЕНА</th>
                  <th className="px-3 py-2 text-center font-label-caps text-[9px] text-on-surface-variant w-14">ЕД.</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="border-t border-outline-variant/10">
                    <td className="px-2 py-1">
                      <input value={line.description} onChange={e => updateLine(i, 'description', e.target.value)}
                        className="w-full bg-transparent focus:outline-none text-on-surface" placeholder="Артикул / услуга" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" value={line.qty} onChange={e => updateLine(i, 'qty', parseFloat(e.target.value) || 0)}
                        className="w-full bg-transparent text-right focus:outline-none text-on-surface" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" step="0.01" value={line.unitPrice} onChange={e => updateLine(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                        className="w-full bg-transparent text-right focus:outline-none text-on-surface" />
                    </td>
                    <td className="px-2 py-1">
                      <input value={line.unit} onChange={e => updateLine(i, 'unit', e.target.value)}
                        className="w-full bg-transparent text-center focus:outline-none text-on-surface" />
                    </td>
                    <td className="px-2 py-1 text-center">
                      {lines.length > 1 && (
                        <button onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))}
                          className="text-error/60 hover:text-error">
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-outline-variant/10 bg-surface-container-high">
                  <td colSpan={2} className="px-3 py-2 font-label-caps text-[9px] text-on-surface-variant text-right">СУМА:</td>
                  <td className="px-3 py-2 text-right font-semibold text-on-surface text-xs">
                    {fmt(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0), form.currency)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {error && <p className="text-error font-label-caps text-label-caps">{error}</p>}
        <div className="flex gap-3 justify-end pt-2 border-t border-outline-variant/10">
          <button onClick={onClose} className="px-5 py-2 border border-outline-variant/30 font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-container">
            Отказ
          </button>
          <button onClick={handleSubmit} disabled={createMutation.isPending}
            className="px-5 py-2 bg-primary text-on-primary font-label-caps text-label-caps hover:bg-primary/90 disabled:opacity-50">
            {createMutation.isPending ? 'Записва...' : 'Запиши'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function OrdersPage() {
  const [orderType, setOrderType] = useState<'CLIENT_ORDER' | 'SUPPLIER_ORDER' | ''>('');
  const [status, setStatus] = useState('');
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [page, setPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['orders', orderType, status, year, page],
    queryFn: () => api.get(`/orders?type=${orderType}&status=${status}&year=${year}&page=${page}&limit=50`).then(r => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/orders/${id}`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orders'] }),
  });

  const orders: any[] = data?.data ?? [];
  const total: number = data?.total ?? 0;

  const filtered = search
    ? orders.filter(o =>
        (o.counterparty?.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (o.project?.code || '').toLowerCase().includes(search.toLowerCase()) ||
        (o.notes || '').toLowerCase().includes(search.toLowerCase())
      )
    : orders;

  return (
    <div className="min-h-screen">
      <div className="border-b border-outline-variant/10 bg-surface-container-lowest sticky top-0 z-10">
        <div className="px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-0.5">БИЗНЕС ЦИКЪЛ</p>
            <h1 className="font-headline text-headline-lg text-on-surface">Поръчки</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-label-caps text-label-caps text-on-surface-variant/60">{total} поръчки</span>
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary font-label-caps text-label-caps hover:bg-primary/90">
              <span className="material-symbols-outlined text-[16px]">add</span>
              Нова поръчка
            </button>
          </div>
        </div>

        <div className="px-8 flex border-t border-outline-variant/5">
          {[
            { value: '', label: 'Всички', icon: 'list' },
            { value: 'CLIENT_ORDER', label: 'От клиенти', icon: 'groups' },
            { value: 'SUPPLIER_ORDER', label: 'Към доставчици', icon: 'local_shipping' },
          ].map(tab => (
            <button key={tab.value} onClick={() => { setOrderType(tab.value as any); setPage(1); }}
              className={`flex items-center gap-2 px-5 py-3 font-label-caps text-label-caps transition-colors border-b-2 -mb-px ${
                orderType === tab.value ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}>
              <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 py-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <select value={year} onChange={e => { setYear(e.target.value); setPage(1); }}
            className="border border-outline-variant/30 bg-surface-container-low px-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary">
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
            className="border border-outline-variant/30 bg-surface-container-low px-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary">
            <option value="">Всички статуси</option>
            <option value="DRAFT">Чернова</option>
            <option value="CONFIRMED">Потвърдена</option>
            <option value="IN_PROGRESS">В процес</option>
            <option value="DELIVERED">Доставена</option>
            <option value="COMPLETED">Завършена</option>
            <option value="CANCELLED">Отказана</option>
          </select>
          <div className="relative flex-1 min-w-[180px]">
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
            <input
              className="border border-outline-variant/30 bg-surface-container-low pl-9 pr-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary w-full"
              placeholder="Търси по клиент, проект..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-surface-container-low border border-outline-variant/10 animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="py-20 text-center border border-outline-variant/10 bg-surface-container-low">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 block mb-3">inventory_2</span>
            <p className="font-body-sm text-body-sm text-on-surface-variant/60">Няма поръчки</p>
            <button onClick={() => setShowModal(true)} className="mt-4 px-5 py-2 border border-primary text-primary font-label-caps text-label-caps hover:bg-primary/5">
              Добави поръчка
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(order => {
              const typeCfg = ORDER_TYPE_LABELS[order.orderType] || { label: order.orderType, icon: 'receipt', color: 'text-on-surface-variant' };
              const linesTotal = (order.lines || []).reduce((s: number, l: any) => s + (l.qty || 0) * (l.unitPrice || 0), 0);
              const isExpanded = expanded === order.id;
              return (
                <div key={order.id} className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
                  <div className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-surface-container transition-colors"
                    onClick={() => setExpanded(isExpanded ? null : order.id)}>
                    <span className={`material-symbols-outlined text-[20px] ${typeCfg.color}`}>{typeCfg.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-medium text-on-surface">{order.counterparty?.name || '—'}</span>
                        {order.project && (
                          <a href={`/projects/${order.project.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}
                            className="font-label-caps text-[9px] text-primary border border-primary/20 px-1.5 py-0.5 hover:bg-primary/5">
                            {order.project.code}
                          </a>
                        )}
                        <span className={`font-label-caps text-[9px] px-2 py-0.5 border ${STATUS_COLORS[order.status] || 'border-outline-variant/30 text-on-surface-variant'}`}>
                          {order.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-on-surface-variant/60 text-xs">
                        <span>{fmtDate(order.orderDate)}</span>
                        <span>{typeCfg.label}</span>
                        {order.lines?.length > 0 && <span>{order.lines.length} ред{order.lines.length > 1 ? 'а' : ''}</span>}
                        {order.deliveries?.length > 0 && <span>{order.deliveries.length} доставк{order.deliveries.length > 1 ? 'и' : 'а'}</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-on-surface">{fmt(linesTotal, order.currency)}</p>
                    </div>
                    <span className={`material-symbols-outlined text-[18px] text-on-surface-variant/40 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      expand_more
                    </span>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-outline-variant/10 px-5 py-4 space-y-4">
                      {order.lines?.length > 0 && (
                        <div>
                          <p className="font-label-caps text-[9px] text-on-surface-variant mb-2">РЕДОВЕ</p>
                          <table className="w-full text-xs border border-outline-variant/10">
                            <thead>
                              <tr className="bg-surface-container-high">
                                <th className="px-3 py-2 text-left font-label-caps text-[9px] text-on-surface-variant">ОПИСАНИЕ</th>
                                <th className="px-3 py-2 text-right font-label-caps text-[9px] text-on-surface-variant">КОЛ.</th>
                                <th className="px-3 py-2 text-right font-label-caps text-[9px] text-on-surface-variant">ЦЕНА</th>
                                <th className="px-3 py-2 text-right font-label-caps text-[9px] text-on-surface-variant">СУМА</th>
                              </tr>
                            </thead>
                            <tbody>
                              {order.lines.map((line: any, i: number) => (
                                <tr key={i} className="border-t border-outline-variant/10">
                                  <td className="px-3 py-2 text-on-surface">{line.description || line.inventoryItem?.name || '—'}</td>
                                  <td className="px-3 py-2 text-right text-on-surface-variant">{line.qty} {line.unit || ''}</td>
                                  <td className="px-3 py-2 text-right text-on-surface-variant">{fmt(line.unitPrice, order.currency)}</td>
                                  <td className="px-3 py-2 text-right font-medium text-on-surface">{fmt(line.qty * line.unitPrice, order.currency)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {order.deliveries?.length > 0 && (
                        <div>
                          <p className="font-label-caps text-[9px] text-on-surface-variant mb-2">ДОСТАВКИ</p>
                          <div className="space-y-1">
                            {order.deliveries.map((d: any) => (
                              <div key={d.id} className="flex items-center gap-3 text-xs border border-outline-variant/10 px-3 py-2">
                                <span className="material-symbols-outlined text-[14px] text-on-surface-variant">local_shipping</span>
                                <span className="text-on-surface-variant">{d.deliveryType}</span>
                                <span className="text-on-surface-variant/60">{fmtDate(d.deliveryDate)}</span>
                                <span className={`font-label-caps text-[9px] px-2 py-0.5 border ml-auto ${STATUS_COLORS[d.status] || 'border-outline-variant/30 text-on-surface-variant'}`}>
                                  {d.status}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {order.notes && <p className="text-xs text-on-surface-variant/60 italic">{order.notes}</p>}

                      <div className="flex justify-end gap-2 pt-2">
                        <button onClick={() => { if (confirm('Изтрий поръчката?')) deleteMutation.mutate(order.id); }}
                          disabled={deleteMutation.isPending}
                          className="flex items-center gap-1.5 px-3 py-1.5 border border-error/30 text-error font-label-caps text-label-caps hover:bg-error/5 disabled:opacity-50">
                          <span className="material-symbols-outlined text-[14px]">delete</span>
                          Изтрий
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {total > 50 && (
          <div className="flex items-center justify-between px-1">
            <span className="font-label-caps text-label-caps text-on-surface-variant/60">
              {(page - 1) * 50 + 1}–{Math.min(page * 50, total)} от {total}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1 border border-outline-variant/30 font-label-caps text-label-caps disabled:opacity-30 hover:bg-surface-container">
                ‹ Назад
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total}
                className="px-3 py-1 border border-outline-variant/30 font-label-caps text-label-caps disabled:opacity-30 hover:bg-surface-container">
                Напред ›
              </button>
            </div>
          </div>
        )}
      </div>

      <OrderModal open={showModal} onClose={() => setShowModal(false)} />
    </div>
  );
}
