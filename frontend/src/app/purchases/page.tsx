'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Plus, Pencil } from 'lucide-react';

interface Purchase {
  id: string;
  date: string;
  invoiceNo?: string;
  amount: number;
  currency: string;
  description?: string;
  status?: string;
  supplierId?: string;
  supplier?: { id: string; name: string };
  project?: { id: string; code: string; name: string };
}

function EditPurchaseModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    invoiceNo: purchase.invoiceNo || '',
    amount: String(purchase.amount),
    currency: purchase.currency || 'EUR',
    description: purchase.description || '',
    status: purchase.status || 'PENDING',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: any) => api.patch(`/purchases/${purchase.id}`, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Грешка при запис'),
  });

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open onClose={onClose} title={`Редакция: ${purchase.supplier?.name || purchase.supplierId}`} size="md">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate({ ...form, amount: Number(form.amount) }); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Фактура №</label>
            <input className="input" value={form.invoiceNo} onChange={e => setField('invoiceNo', e.target.value)} placeholder="0000012345" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Статус</label>
            <select className="input" value={form.status} onChange={e => setField('status', e.target.value)}>
              <option value="PENDING">Чака</option>
              <option value="PAID">Платено</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Сума *</label>
            <input type="number" required min="0" step="0.01" className="input" value={form.amount} onChange={e => setField('amount', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Валута</label>
            <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
              <option value="BGN">BGN</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Описание</label>
          <textarea className="input" rows={2} value={form.description} onChange={e => setField('description', e.target.value)} />
        </div>
        {error && (
          <div className="bg-[rgba(255,69,58,0.1)] border border-[rgba(255,69,58,0.3)] rounded-lg px-3 py-2">
            <p className="text-[#ff453a] text-sm">{error}</p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Отказ</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
            {mutation.isPending ? 'Запис...' : 'Запази'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PurchaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    supplierId: '',
    projectId: '',
    invoiceNo: '',
    currency: 'BGN',
    amount: '',
    description: '',
    status: 'PENDING',
  });
  const [error, setError] = useState('');

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: (payload: any) => api.post('/purchases', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Грешка при запис'),
  });

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title="Нова доставка" size="md">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate({ ...form, amount: Number(form.amount) }); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Дата *</label>
            <input type="date" required className="input" value={form.date} onChange={e => setField('date', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Фактура №</label>
            <input className="input" value={form.invoiceNo} onChange={e => setField('invoiceNo', e.target.value)} placeholder="0000012345" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Доставчик *</label>
          <select required className="input" value={form.supplierId} onChange={e => setField('supplierId', e.target.value)}>
            <option value="">— Избери доставчик —</option>
            {(suppliers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Проект</label>
          <select className="input" value={form.projectId} onChange={e => setField('projectId', e.target.value)}>
            <option value="">— Без проект —</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Сума *</label>
            <input type="number" required min="0" step="0.01" className="input" value={form.amount} onChange={e => setField('amount', e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Валута</label>
            <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
              <option value="BGN">BGN</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Статус</label>
          <select className="input" value={form.status} onChange={e => setField('status', e.target.value)}>
            <option value="PENDING">Чака</option>
            <option value="PAID">Платено</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Описание</label>
          <textarea className="input" rows={2} value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Описание на доставката..." />
        </div>

        {error && (
          <div className="bg-[rgba(255,69,58,0.1)] border border-[rgba(255,69,58,0.3)] rounded-lg px-3 py-2">
            <p className="text-[#ff453a] text-sm">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Отказ</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
            {mutation.isPending ? 'Запис...' : 'Добави доставка'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function PurchasesPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [supplierId, setSupplierId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editPurchase, setEditPurchase] = useState<Purchase | null>(null);

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data),
  });

  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (supplierId) params.set('supplierId', supplierId);

  const { data = [], isLoading } = useQuery({
    queryKey: ['purchases', year, supplierId],
    queryFn: () => api.get(`/purchases?${params}`).then(r => r.data),
    staleTime: 30000,
  });

  const purchases: Purchase[] = Array.isArray(data) ? data : (data as any).data || [];

  const total = purchases.reduce((s, p) => s + (p.currency === 'BGN' ? p.amount : p.amount * 1.95583), 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Доставки</h1>
          <p className="text-[#71717a] text-sm mt-0.5">{purchases.length} записа</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> Нова доставка
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
        <select className="input w-52" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
          <option value="">Всички доставчици</option>
          {(suppliers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Дата</th>
              <th className="table-header">Доставчик</th>
              <th className="table-header">Проект</th>
              <th className="table-header">Фактура №</th>
              <th className="table-header text-right">Сума</th>
              <th className="table-header">Валута</th>
              <th className="table-header">Описание</th>
              <th className="table-header"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {[...Array(7)].map((_, j) => (
                    <td key={j} className="table-cell"><div className="h-4 bg-[#27272a] rounded" /></td>
                  ))}
                </tr>
              ))
            ) : purchases.length === 0 ? (
              <tr><td colSpan={7} className="table-cell text-center text-[#52525b] py-10">Няма доставки</td></tr>
            ) : (
              purchases.map(p => (
                <tr key={p.id} className="hover:bg-[#1d1d1f] transition-colors">
                  <td className="table-cell text-[#a1a1aa]">{fmtDate(p.date)}</td>
                  <td className="table-cell font-medium text-white">{p.supplier?.name || '—'}</td>
                  <td className="table-cell text-xs text-[#0a84ff]">{p.project?.code || '—'}</td>
                  <td className="table-cell font-mono text-xs text-[#a1a1aa]">{p.invoiceNo || '—'}</td>
                  <td className={`table-cell text-right font-semibold ${Number(p.amount) === 0 ? 'text-[#ff9f0a]' : 'text-white'}`}>{fmt(p.amount, p.currency)}</td>
                  <td className="table-cell text-[#71717a] text-xs">{p.currency}</td>
                  <td className="table-cell text-[#71717a] truncate max-w-[200px]">{p.description || '—'}</td>
                  <td className="table-cell w-8">
                    <button onClick={() => setEditPurchase(p)} className="text-[#71717a] hover:text-[#0a84ff] transition-colors" title="Редактирай">
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {!isLoading && purchases.length > 0 && (
            <tfoot>
              <tr className="bg-[#1d1d1f]">
                <td colSpan={4} className="table-cell font-semibold text-[#71717a] text-xs uppercase tracking-wider">Общо (в BGN)</td>
                <td className="table-cell text-right font-bold text-white text-base">
                  {total.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} BGN
                </td>
                <td colSpan={3} className="table-cell" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <PurchaseModal open={modalOpen} onClose={() => setModalOpen(false)} />
      {editPurchase && <EditPurchaseModal purchase={editPurchase} onClose={() => setEditPurchase(null)} />}
    </div>
  );
}
