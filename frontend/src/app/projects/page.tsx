'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, fmtDate } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { Plus, Search, ArrowRight } from 'lucide-react';

interface Project {
  id: string;
  code: string;
  name: string;
  status: string;
  year: number;
  revenue?: number;
  costs?: number;
  invoiceCount?: number;
  client?: { id: string; name: string };
}

function ProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: '', name: '', clientId: '', status: 'ACTIVE',
    year: new Date().getFullYear(), notes: '',
    startDate: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState('');

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: (payload: any) => api.post('/projects', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Грешка при запис'),
  });

  const setField = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title="Нов проект" size="md">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate(form); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Код *</label>
            <input required className="input" value={form.code} onChange={e => setField('code', e.target.value)} placeholder="SB-2025-001" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Година</label>
            <input type="number" className="input" value={form.year} onChange={e => setField('year', Number(e.target.value))} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Наименование *</label>
          <input required className="input" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Описание на проекта" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Клиент</label>
            <select className="input" value={form.clientId} onChange={e => setField('clientId', e.target.value)}>
              <option value="">— Без клиент —</option>
              {(clients as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Статус</label>
            <select className="input" value={form.status} onChange={e => setField('status', e.target.value)}>
              <option value="ACTIVE">Активен</option>
              <option value="COMPLETED">Приключен</option>
              <option value="ON_HOLD">Пауза</option>
              <option value="CANCELLED">Анулиран</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Начална дата</label>
          <input type="date" className="input" value={form.startDate} onChange={e => setField('startDate', e.target.value)} />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Бележки</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Допълнителна информация..." />
        </div>

        {error && (
          <div className="bg-[rgba(255,69,58,0.1)] border border-[rgba(255,69,58,0.3)] rounded-lg px-3 py-2">
            <p className="text-[#ff453a] text-sm">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Отказ</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
            {mutation.isPending ? 'Запис...' : 'Създай проект'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (status) params.set('status', status);

  const { data = [], isLoading } = useQuery({
    queryKey: ['projects', year, status],
    queryFn: () => api.get(`/projects?${params}`).then(r => r.data),
    staleTime: 30000,
  });

  const projects: Project[] = Array.isArray(data) ? data : (data as any).data || [];

  const filtered = search
    ? projects.filter(p =>
        p.code.toLowerCase().includes(search.toLowerCase()) ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.client?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : projects;

  const margin = (p: Project) => {
    const rev = p.revenue || 0;
    const cost = p.costs || 0;
    if (!rev) return '—';
    return `${(((rev - cost) / rev) * 100).toFixed(1)}%`;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Проекти</h1>
          <p className="text-[#71717a] text-sm mt-0.5">{filtered.length} резултата</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> Нов проект
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
          <option value="ACTIVE">Активен</option>
          <option value="COMPLETED">Приключен</option>
          <option value="ON_HOLD">Пауза</option>
          <option value="CANCELLED">Анулиран</option>
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
              <th className="table-header">Наименование</th>
              <th className="table-header">Клиент</th>
              <th className="table-header text-right">Приходи</th>
              <th className="table-header text-right">Разходи</th>
              <th className="table-header text-right">Марж %</th>
              <th className="table-header">Статус</th>
              <th className="table-header w-12"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {[...Array(8)].map((_, j) => (
                    <td key={j} className="table-cell"><div className="h-4 bg-[#27272a] rounded" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="table-cell text-center text-[#52525b] py-10">Няма проекти</td></tr>
            ) : (
              filtered.map(p => (
                <tr key={p.id} className="hover:bg-[#1d1d1f] transition-colors cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                  <td className="table-cell font-mono text-xs font-bold text-[#0a84ff]">{p.code}</td>
                  <td className="table-cell font-medium text-white">{p.name}</td>
                  <td className="table-cell text-[#a1a1aa]">{p.client?.name || '—'}</td>
                  <td className="table-cell text-right font-semibold text-[#30d158]">
                    {(p.revenue || 0).toLocaleString('bg-BG', { minimumFractionDigits: 0 })} BGN
                  </td>
                  <td className="table-cell text-right text-[#ff453a]">
                    {(p.costs || 0).toLocaleString('bg-BG', { minimumFractionDigits: 0 })} BGN
                  </td>
                  <td className="table-cell text-right font-bold text-white">{margin(p)}</td>
                  <td className="table-cell"><StatusBadge status={p.status} /></td>
                  <td className="table-cell">
                    <button className="p-1.5 rounded-lg hover:bg-[#27272a] text-[#71717a] hover:text-white transition-colors">
                      <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
