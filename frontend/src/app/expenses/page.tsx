'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Plus } from 'lucide-react';

interface Expense {
  id: string;
  date: string;
  category: string;
  description?: string;
  amount: number;
  currency: string;
  supplier?: { id: string; name: string };
}

const CATEGORY_SUGGESTIONS = [
  'Наем', 'Счетоводство', 'Транспорт', 'Реклама', 'Заплати',
  'Комунални', 'Ел.материали', 'Офис консумативи', 'Друго'
];

function ExpenseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: '',
    supplierId: '',
    description: '',
    amount: '',
    currency: 'BGN',
  });
  const [error, setError] = useState('');

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: (payload: any) => api.post('/expenses', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Грешка при запис'),
  });

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title="Нов разход" size="md">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate({ ...form, amount: Number(form.amount) }); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Дата *</label>
            <input type="date" required className="input" value={form.date} onChange={e => setField('date', e.target.value)} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Категория *</label>
            <input
              required list="expense-cats" className="input" value={form.category}
              onChange={e => setField('category', e.target.value)} placeholder="Наем, Транспорт..."
            />
            <datalist id="expense-cats">
              {CATEGORY_SUGGESTIONS.map(c => <option key={c} value={c} />)}
            </datalist>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Доставчик / Контрагент</label>
          <select className="input" value={form.supplierId} onChange={e => setField('supplierId', e.target.value)}>
            <option value="">— Без доставчик —</option>
            {(suppliers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Описание</label>
          <input className="input" value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Описание на разхода" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Сума *</label>
            <input type="number" required min="0" step="0.01" className="input" value={form.amount}
              onChange={e => setField('amount', e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Валута</label>
            <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
              <option value="BGN">BGN</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="bg-[rgba(255,69,58,0.1)] border border-[rgba(255,69,58,0.3)] rounded-lg px-3 py-2">
            <p className="text-[#ff453a] text-sm">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Отказ</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
            {mutation.isPending ? 'Запис...' : 'Добави разход'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function ExpensesPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ['expenses', year],
    queryFn: () => api.get(`/expenses?year=${year}`).then(r => r.data),
    staleTime: 30000,
  });

  const expenses: Expense[] = Array.isArray(data) ? data : (data as any).data || [];

  const filtered = search
    ? expenses.filter(e =>
        (e.supplier?.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.category || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.description || '').toLowerCase().includes(search.toLowerCase())
      )
    : expenses;

  const totalBGN = filtered.reduce((s, e) => {
    const amt = Number(e.amount);
    if (e.currency === 'BGN') return s + amt;
    if (e.currency === 'EUR') return s + amt * 1.95583;
    return s + amt;
  }, 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Разходи</h1>
          <p className="text-[#71717a] text-sm mt-0.5">{filtered.length} записа</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> Нов разход
        </button>
      </div>

      {/* Year filter */}
      <div className="flex flex-wrap gap-3 mb-5 items-center">
        <div className="flex gap-1 bg-[#1d1d1f] p-1 rounded-xl">
          {[2024, 2025, 2026].map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`px-3 py-1 rounded-lg text-sm font-semibold transition-all ${
                year === y ? 'bg-[#0a84ff] text-white' : 'text-[#71717a] hover:text-white'
              }`}>{y}</button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <span className="material-symbols-outlined text-[16px] text-[#52525b] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
          <input
            className="input pl-9 w-full"
            placeholder="Търси по доставчик, категория..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead>
            <tr>
              <th className="table-header">Дата</th>
              <th className="table-header">Категория</th>
              <th className="table-header">Доставчик</th>
              <th className="table-header">Описание</th>
              <th className="table-header text-right">Сума</th>
              <th className="table-header">Валута</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {[...Array(6)].map((_, j) => (
                    <td key={j} className="table-cell"><div className="h-4 bg-[#27272a] rounded" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="table-cell text-center text-[#52525b] py-10">Няма разходи</td></tr>
            ) : (
              filtered.map(e => (
                <tr key={e.id} className="hover:bg-[#1d1d1f] transition-colors">
                  <td className="table-cell text-[#a1a1aa]">{fmtDate(e.date)}</td>
                  <td className="table-cell">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[#27272a] text-[#e4e4e7] text-xs font-medium">
                      {e.category}
                    </span>
                  </td>
                  <td className="table-cell text-[#a1a1aa]">{e.supplier?.name || '—'}</td>
                  <td className="table-cell text-[#71717a] truncate max-w-[220px]">{e.description || '—'}</td>
                  <td className="table-cell text-right font-semibold text-white">{fmt(e.amount, e.currency)}</td>
                  <td className="table-cell text-[#71717a] text-xs">{e.currency}</td>
                </tr>
              ))
            )}
          </tbody>
          {!isLoading && filtered.length > 0 && (
            <tfoot>
              <tr className="bg-[#1d1d1f]">
                <td colSpan={4} className="table-cell font-semibold text-[#71717a] text-xs uppercase tracking-wider">Общо (в BGN)</td>
                <td className="table-cell text-right font-bold text-white text-base">
                  {totalBGN.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} BGN
                </td>
                <td className="table-cell" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <ExpenseModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
