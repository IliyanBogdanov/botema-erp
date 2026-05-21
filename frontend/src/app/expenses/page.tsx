'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';
import { Modal } from '@/components/Modal';

interface Expense {
  id: string;
  date: string;
  category: string;
  description?: string;
  amount: number;
  currency: string;
  supplier?: string;
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
    currency: 'EUR',
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
        (e.supplier || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.category || '').toLowerCase().includes(search.toLowerCase()) ||
        (e.description || '').toLowerCase().includes(search.toLowerCase())
      )
    : expenses;

  const totalEUR = filtered.reduce((s, e) => {
    const amt = Number(e.amount);
    if (e.currency === 'BGN') return s + amt / 1.95583;
    if (e.currency === 'EUR') return s + amt;
    return s + amt;
  }, 0);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-outline-variant/10 bg-surface-container-lowest sticky top-0 z-10">
        <div className="px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-0.5">ФИНАНСИ</p>
            <h1 className="font-headline text-headline-lg text-on-surface">Разходи — {year}</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 border border-outline-variant/20 p-0.5">
              {[2024, 2025, 2026].map(y => (
                <button key={y} onClick={() => setYear(y)}
                  className={`px-3 py-1.5 font-label-caps text-label-caps transition-colors ${
                    year === y ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
                  }`}>{y}</button>
              ))}
            </div>
            <button onClick={() => setModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary font-label-caps text-label-caps hover:bg-primary/90">
              <span className="material-symbols-outlined text-[16px]">add</span>
              Нов разход
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-4">
        {/* Search */}
        <div className="relative max-w-sm">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
          <input
            className="w-full border border-outline-variant/30 bg-surface-container-low pl-9 pr-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary"
            placeholder="Търси по доставчик, категория..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-outline-variant/10">
                  <th className="table-header text-left">ДАТА</th>
                  <th className="table-header text-left">КАТЕГОРИЯ</th>
                  <th className="table-header text-left">ДОСТАВЧИК</th>
                  <th className="table-header text-left">ОПИСАНИЕ</th>
                  <th className="table-header text-right">СУМА</th>
                  <th className="table-header text-left">ВАЛ.</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse border-b border-outline-variant/5">
                      {[...Array(6)].map((_, j) => (
                        <td key={j} className="table-cell"><div className="h-4 bg-surface-container-high rounded" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-cell text-center text-on-surface-variant/40 py-12">
                      <span className="material-symbols-outlined text-4xl block mb-2 opacity-30">receipt</span>
                      Няма разходи за {year} г.
                    </td>
                  </tr>
                ) : (
                  filtered.map(e => (
                    <tr key={e.id} className="border-b border-outline-variant/5 hover:bg-surface-container-high transition-colors">
                      <td className="table-cell font-label-caps text-[10px] text-on-surface-variant">{fmtDate(e.date)}</td>
                      <td className="table-cell">
                        <span className="inline-flex items-center px-2 py-0.5 border border-outline-variant/20 bg-surface-container font-label-caps text-[9px] text-on-surface-variant">
                          {e.category}
                        </span>
                      </td>
                      <td className="table-cell text-on-surface-variant/70 text-sm">{e.supplier || '—'}</td>
                      <td className="table-cell text-on-surface-variant/50 text-sm truncate max-w-[220px]">{e.description || '—'}</td>
                      <td className="table-cell text-right font-data-mono text-data-mono text-on-surface font-semibold">{fmt(e.amount, e.currency)}</td>
                      <td className="table-cell font-label-caps text-[9px] text-on-surface-variant/60">{e.currency}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {!isLoading && filtered.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-outline-variant/20 bg-surface-container">
                    <td colSpan={4} className="table-cell font-label-caps text-label-caps text-on-surface-variant">
                      ОБЩО (EUR) — {year} г. · {filtered.length} записа
                    </td>
                    <td className="table-cell text-right font-data-mono text-on-surface font-bold text-base">
                      {totalEUR.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} €
                    </td>
                    <td className="table-cell" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>

      <ExpenseModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
