'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Plus, Search, Pencil, Globe } from 'lucide-react';

interface Supplier {
  id: string;
  name: string;
  country?: string;
  currency: string;
  discount?: string;
  email?: string;
  phone?: string;
  notes?: string;
  _count?: { purchases: number };
}

function SupplierModal({
  open, onClose, existing
}: {
  open: boolean; onClose: () => void; existing?: Supplier | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: existing?.name || '',
    country: existing?.country || '',
    currency: existing?.currency || 'EUR',
    discount: existing?.discount || '',
    email: existing?.email || '',
    phone: existing?.phone || '',
    notes: existing?.notes || '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: any) =>
      existing
        ? api.patch(`/suppliers/${existing.id}`, payload)
        : api.post('/suppliers', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Грешка при запис'),
  });

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Редактирай доставчик' : 'Нов доставчик'} size="lg">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate(form); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Фирма / Марка *</label>
            <input required className="input" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="LODES S.r.l." />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Държава</label>
            <input className="input" value={form.country} onChange={e => setField('country', e.target.value)} placeholder="Италия" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Валута</label>
            <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
              <option value="EUR">EUR</option>
              <option value="BGN">BGN</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Имейл</label>
            <input className="input" type="email" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="info@supplier.com" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Телефон</label>
            <input className="input" value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="+39 ..." />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Отстъпка</label>
            <input className="input" value={form.discount} onChange={e => setField('discount', e.target.value)} placeholder="45-50%" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Бележки</label>
            <textarea className="input min-h-[80px] resize-none" value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Допълнителна информация..." />
          </div>
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Отказ</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Запазване...' : (existing ? 'Запази' : 'Добави')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function SuppliersPage() {
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers').then(r => r.data),
    staleTime: 30000,
  });

  const suppliers: Supplier[] = Array.isArray(data) ? data : [];

  const filtered = search
    ? suppliers.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.country?.toLowerCase().includes(search.toLowerCase()) ||
        s.email?.toLowerCase().includes(search.toLowerCase())
      )
    : suppliers;

  const openEdit = (s: Supplier) => { setEditing(s); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditing(null); };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Доставчици</h1>
          <p className="text-[#71717a] text-sm mt-0.5">{filtered.length} доставчика</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> Нов доставчик
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525b]" />
          <input className="input pl-8" placeholder="Търси фирма, държава, имейл..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Доставчик</th>
              <th className="table-header">Държава</th>
              <th className="table-header">Валута</th>
              <th className="table-header">Отстъпка</th>
              <th className="table-header">Имейл</th>
              <th className="table-header">Телефон</th>
              <th className="table-header w-12"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {[...Array(7)].map((_, j) => (
                    <td key={j} className="table-cell"><div className="h-4 bg-[#27272a] rounded" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="table-cell text-center text-[#52525b] py-10">Няма доставчици</td></tr>
            ) : (
              filtered.map(s => (
                <tr key={s.id} className="hover:bg-[#1d1d1f] transition-colors">
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-[#27272a] flex items-center justify-center shrink-0">
                        <Globe size={12} className="text-[#71717a]" />
                      </div>
                      <span className="font-medium text-white">{s.name}</span>
                    </div>
                  </td>
                  <td className="table-cell text-[#a1a1aa]">{s.country || '—'}</td>
                  <td className="table-cell">
                    <span className="text-xs font-mono bg-[#27272a] text-[#a1a1aa] px-1.5 py-0.5 rounded">{s.currency}</span>
                  </td>
                  <td className="table-cell text-[#a1a1aa] text-sm">{s.discount || '—'}</td>
                  <td className="table-cell text-[#a1a1aa] text-xs">{s.email || '—'}</td>
                  <td className="table-cell text-[#a1a1aa] text-xs">{s.phone || '—'}</td>
                  <td className="table-cell">
                    <button onClick={() => openEdit(s)} className="p-1.5 hover:bg-[#27272a] rounded text-[#52525b] hover:text-white transition-colors">
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SupplierModal open={modalOpen} onClose={closeModal} existing={editing} />
    </div>
  );
}
