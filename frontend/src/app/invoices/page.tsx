'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtBgn, fmtDate, statusConfig } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { StatusBadge } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';

interface InvoiceItem {
  description: string;
  qty: number;
  unitPrice: number;
  vatPct: number;
}

interface Invoice {
  id: string;
  number: string;
  date: string;
  dueDate: string;
  status: string;
  amountNet: number;
  vatAmount: number;
  amountTotal: number;
  currency: string;
  client?: { id: string; name: string };
  project?: { id: string; code: string; name: string };
}

const modalLabelClass = 'block font-label-caps text-label-caps text-on-surface-variant mb-1.5';

function InvoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    clientId: '', projectId: '', type: 'INVOICE', brand: 'STUDIO_BOTEMA',
    currency: 'EUR', date: new Date().toISOString().slice(0, 10),
    dueDate: '', description: '', notes: '',
  });
  const [items, setItems] = useState<InvoiceItem[]>([
    { description: '', qty: 1, unitPrice: 0, vatPct: 20 }
  ]);
  const [error, setError] = useState('');

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: (payload: any) => api.post('/invoices', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['invoices'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Грешка при запис'),
  });

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const setItem = (i: number, k: keyof InvoiceItem, v: string | number) =>
    setItems(items => items.map((item, idx) => idx === i ? { ...item, [k]: v } : item));

  const addItem = () => setItems(i => [...i, { description: '', qty: 1, unitPrice: 0, vatPct: 20 }]);
  const removeItem = (i: number) => setItems(items => items.filter((_, idx) => idx !== i));

  const net = items.reduce((s, it) => s + it.qty * it.unitPrice, 0);
  const vat = items.reduce((s, it) => s + it.qty * it.unitPrice * it.vatPct / 100, 0);
  const total = net + vat;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    mutation.mutate({ ...form, items });
  };

  return (
    <Modal open={open} onClose={onClose} title="Нова фактура" size="xl">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={modalLabelClass}>Клиент *</label>
            <select required className="input" value={form.clientId} onChange={e => setField('clientId', e.target.value)}>
              <option value="">— Избери —</option>
              {(clients as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={modalLabelClass}>Проект</label>
            <select className="input" value={form.projectId} onChange={e => setField('projectId', e.target.value)}>
              <option value="">— Без проект —</option>
              {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className={modalLabelClass}>Тип</label>
            <select className="input" value={form.type} onChange={e => setField('type', e.target.value)}>
              <option value="INVOICE">Фактура</option>
              <option value="PROFORMA">Проформа</option>
              <option value="CREDIT_NOTE">Кредитно известие</option>
            </select>
          </div>
          <div>
            <label className={modalLabelClass}>Марка</label>
            <select className="input" value={form.brand} onChange={e => setField('brand', e.target.value)}>
              <option value="STUDIO_BOTEMA">Studio Botema</option>
              <option value="LUMINAVERA">Luminavera</option>
            </select>
          </div>
          <div>
            <label className={modalLabelClass}>Валута</label>
            <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
              <option value="BGN">BGN</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label className={modalLabelClass}>Дата</label>
            <input type="date" required className="input" value={form.date} onChange={e => setField('date', e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={modalLabelClass}>Падеж</label>
            <input type="date" className="input" value={form.dueDate} onChange={e => setField('dueDate', e.target.value)} />
          </div>
          <div>
            <label className={modalLabelClass}>Описание</label>
            <input type="text" className="input" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Описание на фактурата" />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className={modalLabelClass}>Артикули</label>
            <button type="button" onClick={addItem} className="btn-secondary flex items-center gap-1 px-2 py-1 text-xs">
              <span className="material-symbols-outlined text-[16px]">add</span>
              Добави ред
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#27272a]">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr>
                  <th className="table-header">Описание</th>
                  <th className="table-header w-16 text-right">Бр.</th>
                  <th className="table-header w-28 text-right">Ед. цена</th>
                  <th className="table-header w-16 text-right">ДДС %</th>
                  <th className="table-header w-24 text-right">Общо</th>
                  <th className="table-header w-10"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} className="bg-[#09090b]">
                    <td className="table-cell">
                      <input className="input py-1" value={item.description} onChange={e => setItem(i, 'description', e.target.value)} placeholder="Описание..." />
                    </td>
                    <td className="table-cell">
                      <input type="number" className="input py-1 text-right" value={item.qty} min="1" onChange={e => setItem(i, 'qty', Number(e.target.value))} />
                    </td>
                    <td className="table-cell">
                      <input type="number" className="input py-1 text-right" value={item.unitPrice} min="0" step="0.01" onChange={e => setItem(i, 'unitPrice', Number(e.target.value))} />
                    </td>
                    <td className="table-cell">
                      <input type="number" className="input py-1 text-right" value={item.vatPct} min="0" max="100" onChange={e => setItem(i, 'vatPct', Number(e.target.value))} />
                    </td>
                    <td className="table-cell text-right font-semibold text-white">
                      {fmt(item.qty * item.unitPrice, form.currency)}
                    </td>
                    <td className="table-cell text-center">
                      {items.length > 1 && (
                        <button type="button" onClick={() => removeItem(i)} className="text-on-surface-variant/50 transition-colors hover:text-error">
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex justify-end">
            <div className="min-w-[200px] space-y-1 text-sm">
              <div className="flex justify-between text-on-surface-variant/60">
                <span>Нето:</span>
                <span className="font-semibold text-on-surface">{fmt(net, form.currency)}</span>
              </div>
              <div className="flex justify-between text-on-surface-variant/60">
                <span>ДДС:</span>
                <span className="font-semibold text-on-surface">{fmt(vat, form.currency)}</span>
              </div>
              <div className="flex justify-between border-t border-outline-variant/20 pt-1 font-bold">
                <span className="text-on-surface">Общо:</span>
                <span className="text-primary text-base">{fmt(total, form.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className={modalLabelClass}>Забележки</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Допълнителни бележки..." />
        </div>

        {error && (
          <div className="border border-error/30 bg-error/5 px-3 py-2">
            <p className="text-error text-sm">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary">Отказ</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
            {mutation.isPending ? 'Запис...' : 'Създай фактура'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const cleanStatusLabel = (value: string) => value.replace(/^[^A-Za-zА-Яа-я0-9]+/, '').trim();

function StitchStatusBadge({ status }: { status: string }) {
  const label = cleanStatusLabel(statusConfig[status]?.label || status);
  const className = status === 'PAID'
    ? 'bg-primary-container/20 text-primary border-primary-container/30'
    : status === 'CANCELLED'
      ? 'bg-error-container/20 text-error border-error/30'
      : 'bg-surface-container-high text-on-surface-variant border-outline-variant/20';

  return (
    <span className={`inline-flex items-center border px-2 py-0.5 font-label-caps text-[9px] ${className}`}>
      {label}
    </span>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-surface-container-low border border-outline-variant/10 p-5">
      <p className="font-label-caps text-label-caps text-on-surface-variant">{label}</p>
      <p className="mt-3 font-headline text-headline-md text-on-surface">{value}</p>
      <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant">{sub}</p>
    </div>
  );
}

function StatusMenu({ invoice }: { invoice: Invoice }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const setStatus = async (status: string) => {
    try {
      await api.patch(`/invoices/${invoice.id}`, { status });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch {}
    setOpen(false);
  };

  const statuses = ['PAID', 'OVERDUE', 'CANCELLED'].filter(s => s !== invoice.status);

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-2 border border-outline-variant/20 bg-surface-container px-3 py-2 font-label-caps text-label-caps text-on-surface transition-colors hover:bg-surface-container-high">
        <span className="material-symbols-outlined text-[18px]">edit</span>
        Статус
        <span className="material-symbols-outlined text-[18px]">expand_more</span>
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 min-w-[140px] border border-outline-variant/10 bg-surface-container-low py-1 shadow-xl">
          {statuses.map(s => {
            const cfg = statusConfig[s] || { label: s };
            const label = cleanStatusLabel(cfg.label);
            return (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className="w-full px-3 py-2 text-left font-label-caps text-label-caps text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CY = new Date().getFullYear();
const yearTabs = [CY - 2, CY - 1, CY];
function getStatusTabs(t: ReturnType<typeof useT>) {
  return [
    { label: t('inv.all'),       value: '' },
    { label: t('inv.pending'),   value: 'PENDING' },
    { label: t('inv.overdue'),   value: 'OVERDUE' },
    { label: t('inv.paid'),      value: 'PAID' },
    { label: t('inv.cancelled'), value: 'CANCELLED' },
  ];
}

const AGING_BUCKETS = [
  { key: 'CURRENT',      label: 'Текущи',       color: 'text-primary',           bar: 'bg-primary-container' },
  { key: '1-30_DAYS',    label: '1-30 дни',     color: 'text-warning',            bar: 'bg-warning' },
  { key: '31-60_DAYS',   label: '31-60 дни',    color: 'text-orange-400',         bar: 'bg-orange-400' },
  { key: '61-90_DAYS',   label: '61-90 дни',    color: 'text-error',              bar: 'bg-error' },
  { key: 'OVER_90_DAYS', label: '90+ дни',      color: 'text-error font-bold',    bar: 'bg-error' },
  { key: 'NO_DUE_DATE',  label: 'Без дата',     color: 'text-on-surface-variant', bar: 'bg-outline-variant' },
];

function AgingView() {
  const { data, isLoading } = useQuery({
    queryKey: ['invoices-aging'],
    queryFn: () => api.get('/invoices/aging').then(r => r.data),
    staleTime: 60000,
  });

  if (isLoading) return (
    <div className="space-y-3">
      {[...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse bg-surface-container-low border border-outline-variant/10" />)}
    </div>
  );

  const summary: Record<string, number> = data?.summary || {};
  const invoices: any[] = data?.invoices || [];
  const total = Object.values(summary).reduce((s, v) => s + v, 0);

  return (
    <div className="space-y-6">
      {/* Aging disclaimer */}
      <div className="flex items-center gap-2 text-on-surface-variant/50">
        <span className="material-symbols-outlined text-[14px]">info</span>
        <p className="font-label-caps text-[9px] tracking-wider uppercase">
          Всички неплатени фактури към {new Date().toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', year: 'numeric' })} — независимо от година
        </p>
      </div>

      {/* Bucket summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {AGING_BUCKETS.map(b => {
          const amt = summary[b.key] || 0;
          const pct = total > 0 ? Math.round((amt / total) * 100) : 0;
          return (
            <div key={b.key} className="bg-surface-container-low border border-outline-variant/10 p-4">
              <p className="font-label-caps text-[9px] text-on-surface-variant mb-2">{b.label}</p>
              <p className={`font-headline text-headline-sm ${b.color}`}>
                {(amt / 1.95583).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} €
              </p>
              <div className="mt-2 h-1 bg-surface-container-high overflow-hidden">
                <div className={`h-full ${b.bar} transition-all duration-700`} style={{ width: `${pct}%` }} />
              </div>
              <p className="font-label-caps text-[9px] text-on-surface-variant/40 mt-1">{pct}%</p>
            </div>
          );
        })}
      </div>

      {/* Aging table */}
      <div className="overflow-x-auto bg-surface-container-low border border-outline-variant/10">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr>
              <th className="table-header">ФАКТУРА</th>
              <th className="table-header">КЛИЕНТ</th>
              <th className="table-header">ПАДЕЖ</th>
              <th className="table-header text-right">ДНИ ПРОСРОЧИЕ</th>
              <th className="table-header text-right">СУМА</th>
              <th className="table-header">СТАТУС</th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr><td colSpan={6} className="table-cell py-12 text-center text-on-surface-variant">Няма просрочени фактури</td></tr>
            ) : (
              invoices.map((inv: any) => {
                const bucket = AGING_BUCKETS.find(b => b.key === inv.bucket);
                return (
                  <tr key={inv.id} className="hover:bg-surface-container transition-colors">
                    <td className="table-cell font-data-mono text-data-mono">
                      <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">{inv.number}</Link>
                    </td>
                    <td className="table-cell font-medium text-on-surface">{inv.clientName || '—'}</td>
                    <td className="table-cell text-on-surface-variant">{inv.dueDate ? fmtDate(inv.dueDate) : '—'}</td>
                    <td className="table-cell text-right">
                      {inv.daysOverdue !== null ? (
                        <span className={`font-data-mono text-data-mono ${bucket?.color || ''}`}>
                          {inv.daysOverdue > 0 ? `+${inv.daysOverdue}` : inv.daysOverdue}
                        </span>
                      ) : <span className="text-on-surface-variant/30">—</span>}
                    </td>
                    <td className="table-cell text-right font-data-mono text-data-mono text-on-surface">
                      {fmt(inv.amountTotal, inv.currency)}
                    </td>
                    <td className="table-cell"><StitchStatusBadge status={inv.status} /></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function InvoicesPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [showAging, setShowAging] = useState(false);

  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const { data = [], isLoading } = useQuery({
    queryKey: ['invoices', year, status, search],
    queryFn: () => api.get(`/invoices?${params}`).then(r => r.data),
    staleTime: 30000,
  });
  const t = useT();
  const statusTabs = getStatusTabs(t);

  const invoices: Invoice[] = Array.isArray(data) ? data : (data as any).data || [];
  const totalAmount = invoices
    .filter(inv => !['CANCELLED', 'ARCHIVED'].includes(inv.status))
    .reduce((sum, invoice) => sum + Number(invoice.amountTotal), 0);
  const outstanding = invoices.filter(invoice => !['PAID', 'CANCELLED'].includes(invoice.status)).reduce((sum, invoice) => sum + Number(invoice.amountTotal), 0);
  const paidCount = invoices.filter(invoice => invoice.status === 'PAID').length;

  return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding text-on-surface">
      <div className="mx-auto max-w-7xl space-y-section-gap">
        <section className="flex justify-between items-end mb-section-gap">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-2">{t('inv.label')}</p>
            <h2 className="font-headline text-headline-lg text-on-surface">{t('inv.title')}</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAging(v => !v)}
              className={`flex items-center gap-2 border px-4 py-2 font-label-caps text-label-caps transition-colors ${showAging ? 'border-primary bg-primary-container/10 text-primary' : 'border-outline-variant/30 text-on-surface-variant hover:text-on-surface'}`}
            >
              <span className="material-symbols-outlined text-[18px]">schedule</span>
              AGING
            </button>
            <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px]">add</span>
              {t('inv.new')}
            </button>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label={t('inv.totalInvoices')} value={String(invoices.length)} sub={`${year} година`} />
          <MetricCard label={t('inv.totalBgn')} value={fmtBgn(totalAmount)} sub="фактурирана стойност" />
          <MetricCard label={t('inv.outstanding')} value={fmtBgn(outstanding)} sub="неприключени фактури" />
          <MetricCard label={t('inv.paid')} value={String(paidCount)} sub="приключени плащания" />
        </div>

        {showAging ? <AgingView /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-1 border border-outline-variant/20 bg-surface-container p-1 w-fit">
              {statusTabs.map(tab => (
                <button
                  key={tab.label}
                  onClick={() => setStatus(tab.value)}
                  className={`px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                    status === tab.value
                      ? 'bg-primary-container text-on-primary-container'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex gap-1 border border-outline-variant/20 bg-surface-container p-1">
              {yearTabs.map(tabYear => (
                <button
                  key={tabYear}
                  onClick={() => setYear(tabYear)}
                  className={`px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                    year === tabYear
                      ? 'bg-primary-container text-on-primary-container'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {tabYear}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">search</span>
            <input
              className="input w-full py-3 pl-12"
              placeholder="Търси клиент, проект или номер..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto bg-surface-container-low border border-outline-variant/10">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr>
                  <th className="table-header">{t('inv.colNumber')}</th>
                  <th className="table-header">{t('inv.colClient')}</th>
                  <th className="table-header">{t('inv.colProject')}</th>
                  <th className="table-header">{t('inv.colDate')}</th>
                  <th className="table-header">{t('inv.colDue')}</th>
                  <th className="table-header text-right">{t('inv.colAmount')}</th>
                  <th className="table-header">{t('inv.colStatus')}</th>
                  <th className="table-header w-[140px]"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i} className="animate-pulse hover:bg-surface-container-high">
                      {[...Array(8)].map((_, j) => (
                        <td key={j} className="table-cell"><div className="h-4 w-full rounded bg-surface-container-high" /></td>
                      ))}
                    </tr>
                  ))
                ) : invoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="table-cell py-12 text-center text-on-surface-variant">{t('inv.none')}</td>
                  </tr>
                ) : (
                  invoices.map(inv => (
                    <tr key={inv.id} className="transition-colors hover:bg-surface-container-high">
                      <td className="table-cell font-data-mono text-data-mono">
                        <Link href={`/invoices/${inv.id}`} className="text-primary hover:underline">
                          {inv.number}
                        </Link>
                      </td>
                      <td className="table-cell">
                        <div>
                          <p className="font-medium text-on-surface">{inv.client?.name || '—'}</p>
                          <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">{inv.currency}</p>
                        </div>
                      </td>
                      <td className="table-cell text-on-surface-variant">{inv.project?.name || inv.project?.code || '—'}</td>
                      <td className="table-cell text-on-surface-variant">{fmtDate(inv.date)}</td>
                      <td className="table-cell text-on-surface-variant">{inv.dueDate ? fmtDate(inv.dueDate) : '—'}</td>
                      <td className="table-cell text-right font-data-mono text-data-mono">{fmt(inv.amountTotal, inv.currency)}</td>
                      <td className="table-cell"><StitchStatusBadge status={inv.status} /></td>
                      <td className="table-cell"><StatusMenu invoice={inv} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        )}
        <InvoiceModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </div>
    </div>
  );
}

