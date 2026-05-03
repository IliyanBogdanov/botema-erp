'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Plus, Search } from 'lucide-react';

interface InventoryItem {
  id: string;
  code: string;
  name: string;
  category: string;
  qtyIn: number;
  qtyOut: number;
  qtyBalance: number;
  location?: string;
  supplier?: { id: string; name: string };
  project?: { id: string; code: string };
}

const CATEGORIES = ['LIGHTING', 'ELECTRICAL', 'SAMPLE', 'FURNITURE', 'MIRROR', 'OTHER'];
const CATEGORY_LABELS: Record<string, string> = {
  LIGHTING: 'Осветление', ELECTRICAL: 'Електро', SAMPLE: 'Мостра',
  FURNITURE: 'Мебели', MIRROR: 'Огледало', OTHER: 'Друго'
};

function StockMovementModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    type: 'IN',
    itemId: '',
    qty: '1',
    date: new Date().toISOString().slice(0, 10),
    reference: '',
    notes: '',
    location: '',
  });
  const [newItem, setNewItem] = useState({
    code: '', name: '', supplierId: '', category: 'OTHER'
  });
  const [createNew, setCreateNew] = useState(false);
  const [error, setError] = useState('');

  const { data: items = [] } = useQuery({
    queryKey: ['inventory-items'],
    queryFn: () => api.get('/inventory').then(r => r.data),
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: (payload: any) => api.post('/inventory/movements', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['inventory-items'] });
      onClose();
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Грешка при запис'),
  });

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const setNI = (k: string, v: string) => setNewItem(i => ({ ...i, [k]: v }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = { ...form, qty: Number(form.qty) };
    if (createNew) payload.newItem = newItem;
    mutation.mutate(payload);
  };

  return (
    <Modal open={open} onClose={onClose} title="Добави движение" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Тип движение</label>
            <select className="input" value={form.type} onChange={e => setField('type', e.target.value)}>
              <option value="IN">Постъпване</option>
              <option value="OUT">Изписване</option>
              <option value="SAMPLE">Мостра</option>
              <option value="RETURN">Връщане</option>
              <option value="ADJUST">Корекция</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Дата</label>
            <input type="date" required className="input" value={form.date} onChange={e => setField('date', e.target.value)} />
          </div>
        </div>

        {/* Item selection */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-[#71717a] uppercase tracking-wider">Артикул</label>
            <button type="button" onClick={() => setCreateNew(v => !v)}
              className="text-xs text-[#0a84ff] hover:underline">
              {createNew ? 'Избери съществуващ' : '+ Нов артикул'}
            </button>
          </div>
          {createNew ? (
            <div className="space-y-3 p-3 bg-[#09090b] rounded-xl border border-[#27272a]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#71717a] mb-1">Код</label>
                  <input className="input" value={newItem.code} onChange={e => setNI('code', e.target.value)} placeholder="LMP-001" />
                </div>
                <div>
                  <label className="block text-xs text-[#71717a] mb-1">Категория</label>
                  <select className="input" value={newItem.category} onChange={e => setNI('category', e.target.value)}>
                    {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#71717a] mb-1">Наименование</label>
                <input className="input" value={newItem.name} onChange={e => setNI('name', e.target.value)} placeholder="Описание на артикула" />
              </div>
              <div>
                <label className="block text-xs text-[#71717a] mb-1">Доставчик</label>
                <select className="input" value={newItem.supplierId} onChange={e => setNI('supplierId', e.target.value)}>
                  <option value="">— Без доставчик —</option>
                  {(suppliers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          ) : (
            <select required={!createNew} className="input" value={form.itemId} onChange={e => setField('itemId', e.target.value)}>
              <option value="">— Избери артикул —</option>
              {(items as any[]).map((it: any) => (
                <option key={it.id} value={it.id}>{it.code} – {it.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Количество *</label>
            <input type="number" required min="1" className="input" value={form.qty} onChange={e => setField('qty', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Референция</label>
            <input className="input" value={form.reference} onChange={e => setField('reference', e.target.value)} placeholder="Фактура №..." />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Склад/Локация</label>
            <input className="input" value={form.location} onChange={e => setField('location', e.target.value)} placeholder="Склад А" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Бележки</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} />
        </div>

        {error && (
          <div className="bg-[rgba(255,69,58,0.1)] border border-[rgba(255,69,58,0.3)] rounded-lg px-3 py-2">
            <p className="text-[#ff453a] text-sm">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Отказ</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
            {mutation.isPending ? 'Запис...' : 'Добави движение'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function InventoryPage() {
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const params = new URLSearchParams();
  if (category) params.set('category', category);

  const { data = [], isLoading } = useQuery({
    queryKey: ['inventory', category],
    queryFn: () => api.get(`/inventory?${params}`).then(r => r.data),
    staleTime: 30000,
  });

  const items: InventoryItem[] = Array.isArray(data) ? data : (data as any).data || [];

  const filtered = search
    ? items.filter(it =>
        it.code.toLowerCase().includes(search.toLowerCase()) ||
        it.name.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  const typeColor = (type: string) => {
    if (type === 'IN' || type === 'RETURN') return '#30d158';
    if (type === 'OUT' || type === 'SAMPLE') return '#ff453a';
    return '#ff9f0a';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Склад</h1>
          <p className="text-[#71717a] text-sm mt-0.5">{filtered.length} артикула</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> Добави движение
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <select className="input w-44" value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">Всички категории</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525b]" />
          <input className="input pl-8" placeholder="Търси код, наименование..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Код</th>
              <th className="table-header">Артикул</th>
              <th className="table-header">Категория</th>
              <th className="table-header">Доставчик</th>
              <th className="table-header text-right">Постъпило</th>
              <th className="table-header text-right">Изписано</th>
              <th className="table-header text-right">Налично</th>
              <th className="table-header">Склад</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {[...Array(8)].map((_, j) => (
                    <td key={j} className="table-cell"><div className="h-4 bg-[#27272a] rounded" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="table-cell text-center text-[#52525b] py-10">Няма артикули</td></tr>
            ) : (
              filtered.map(it => (
                <tr key={it.id} className="hover:bg-[#1d1d1f] transition-colors">
                  <td className="table-cell font-mono text-xs text-[#a1a1aa]">{it.code}</td>
                  <td className="table-cell font-medium text-white">{it.name}</td>
                  <td className="table-cell">
                    <span className="text-xs text-[#71717a]">{CATEGORY_LABELS[it.category] || it.category}</span>
                  </td>
                  <td className="table-cell text-[#71717a] text-xs">{it.supplier?.name || '—'}</td>
                  <td className="table-cell text-right text-[#30d158] font-semibold">{it.qtyIn ?? 0}</td>
                  <td className="table-cell text-right text-[#ff453a] font-semibold">{it.qtyOut ?? 0}</td>
                  <td className="table-cell text-right">
                    <span className={`font-bold text-base ${(it.qtyBalance ?? 0) > 0 ? 'text-white' : 'text-[#ff453a]'}`}>
                      {it.qtyBalance ?? 0}
                    </span>
                  </td>
                  <td className="table-cell text-xs text-[#71717a]">{it.location || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <StockMovementModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
