'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtDate, statusConfig } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { Plus, Search, ChevronDown, Trash2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
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

// ─── Invoice Modal ────────────────────────────────────────────────────────────
function InvoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    clientId: '', projectId: '', type: 'INVOICE', brand: 'STUDIO_BOTEMA',
    currency: 'BGN', date: new Date().toISOString().slice(0, 10),
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
        {/* Row 1 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Клиент *</label>
            <select required className="input" value={form.clientId} onChange={e => setField('clientId', e.target.value)}>
              <option value="">— Избери —</option>
              {(clients as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Проект</label>
            <select className="input" value={form.projectId} onChange={e => setField('projectId', e.target.value)}>
              <option value="">— Без проект —</option>
              {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2 */}
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Тип</label>
            <select className="input" value={form.type} onChange={e => setField('type', e.target.value)}>
              <option value="INVOICE">Фактура</option>
              <option value="PROFORMA">Проформа</option>
              <option value="CREDIT_NOTE">Кредитно известие</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Марка</label>
            <select className="input" value={form.brand} onChange={e => setField('brand', e.target.value)}>
              <option value="STUDIO_BOTEMA">Studio Botema</option>
              <option value="LUMINAVERA">Luminavera</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Валута</label>
            <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
              <option value="BGN">BGN</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Дата</label>
            <input type="date" required className="input" value={form.date} onChange={e => setField('date', e.target.value)} />
          </div>
        </div>

        {/* Row 3 */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Падеж</label>
            <input type="date" className="input" value={form.dueDate} onChange={e => setField('dueDate', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Описание</label>
            <input type="text" className="input" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Описание на фактурата" />
          </div>
        </div>

        {/* Items table */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-[#71717a] uppercase tracking-wider">Артикули</label>
            <button type="button" onClick={addItem} className="btn-secondary text-xs py-1 px-2 flex items-center gap-1">
              <Plus size={12} /> Добави ред
            </button>
          </div>
          <div className="border border-[#27272a] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
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
                        <button type="button" onClick={() => removeItem(i)} className="text-[#71717a] hover:text-[#ff453a] transition-colors">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="mt-3 flex justify-end">
            <div className="space-y-1 text-sm min-w-[200px]">
              <div className="flex justify-between text-[#71717a]">
                <span>Нето:</span>
                <span className="font-semibold text-white">{fmt(net, form.currency)}</span>
              </div>
              <div className="flex justify-between text-[#71717a]">
                <span>ДДС:</span>
                <span className="font-semibold text-white">{fmt(vat, form.currency)}</span>
              </div>
              <div className="flex justify-between border-t border-[#27272a] pt-1 font-bold">
                <span className="text-white">Общо:</span>
                <span className="text-[#0a84ff] text-base">{fmt(total, form.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Забележки</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Допълнителни бележки..." />
        </div>

        {error && (
          <div className="bg-[rgba(255,69,58,0.1)] border border-[rgba(255,69,58,0.3)] rounded-lg px-3 py-2">
            <p className="text-[#ff453a] text-sm">{error}</p>
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

// ─── Status Action Menu ───────────────────────────────────────────────────────
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
      <button onClick={() => setOpen(o => !o)} className="btn-secondary text-xs py-1 px-2 flex items-center gap-1">
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 bg-[#1d1d1f] border border-[#27272a] rounded-xl shadow-xl z-10 py-1 min-w-[130px]">
          {statuses.map(s => {
            const cfg = statusConfig[s] || { label: s };
            return (
              <button key={s} onClick={() => setStatus(s)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-[#27272a] transition-colors"
                style={{ color: statusConfig[s]?.color || '#e4e4e7' }}>
                {cfg.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function InvoicesPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (status) params.set('status', status);
  if (search) params.set('search', search);

  const { data = [], isLoading } = useQuery({
    queryKey: ['invoices', year, status, search],
    queryFn: () => api.get(`/invoices?${params}`).then(r => r.data),
    staleTime: 30000,
  });

  const invoices: Invoice[] = Array.isArray(data) ? data : (data as any).data || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Фактури</h1>
          <p className="text-[#71717a] text-sm mt-0.5">{invoices.length} резултата</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> Нова фактура
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="flex gap-1 bg-[#1d1d1f] p-1 rounded-xl">
          {[2024, 2025, 2026].map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold transition-all ${
                year === y ? 'bg-[#0a84ff] text-white' : 'text-[#71717a] hover:text-white'
              }`}>{y}</button>
          ))}
        </div>
        <select className="input w-40" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Всички статуси</option>
          <option value="PENDING">Чака</option>
          <option value="PAID">Платено</option>
          <option value="OVERDUE">Просрочено</option>
          <option value="CANCELLED">Анулирана</option>
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525b]" />
          <input className="input pl-8" placeholder="Търси клиент, №..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">№</th>
              <th className="table-header">Дата</th>
              <th className="table-header">Клиент</th>
              <th className="table-header">Проект</th>
              <th className="table-header text-right">Нето</th>
              <th className="table-header text-right">ДДС</th>
              <th className="table-header text-right">Общо</th>
              <th className="table-header">Статус</th>
              <th className="table-header w-12"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {[...Array(9)].map((_, j) => (
                    <td key={j} className="table-cell">
                      <div className="h-4 bg-[#27272a] rounded w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : invoices.length === 0 ? (
              <tr><td colSpan={9} className="table-cell text-center text-[#52525b] py-10">Няма фактури</td></tr>
            ) : (
              invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-[#1d1d1f] transition-colors">
                  <td className="table-cell font-mono text-xs text-[#a1a1aa]">{inv.number}</td>
                  <td className="table-cell text-[#a1a1aa]">{fmtDate(inv.date)}</td>
                  <td className="table-cell font-medium text-white">{inv.client?.name || '—'}</td>
                  <td className="table-cell text-[#a1a1aa] text-xs">{inv.project?.code || '—'}</td>
                  <td className="table-cell text-right font-semibold text-white">{fmt(inv.amountNet, inv.currency)}</td>
                  <td className="table-cell text-right text-[#71717a]">{fmt(inv.vatAmount, inv.currency)}</td>
                  <td className="table-cell text-right font-bold text-white">{fmt(inv.amountTotal, inv.currency)}</td>
                  <td className="table-cell"><StatusBadge status={inv.status} /></td>
                  <td className="table-cell"><StatusMenu invoice={inv} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <InvoiceModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
