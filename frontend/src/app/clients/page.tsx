'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { Plus, Search, Pencil } from 'lucide-react';

interface Client {
  id: string;
  name: string;
  type: string;
  city?: string;
  email?: string;
  phone?: string;
  brand?: string;
  invoiceCount?: number;
  eik?: string;
  vat?: string;
}

function ClientModal({
  open, onClose, existing
}: {
  open: boolean; onClose: () => void; existing?: Client | null;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: existing?.name || '',
    type: existing?.type || 'COMPANY',
    eik: existing?.eik || '',
    vat: existing?.vat || '',
    address: '',
    city: existing?.city || '',
    mol: '',
    email: existing?.email || '',
    phone: existing?.phone || '',
    brand: existing?.brand || 'STUDIO_BOTEMA',
    since: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: any) =>
      existing
        ? api.patch(`/clients/${existing.id}`, payload)
        : api.post('/clients', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['clients'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Грешка при запис'),
  });

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Редактирай клиент' : 'Нов клиент'} size="lg">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate(form); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Фирма / Имe *</label>
            <input required className="input" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Фирма ЕООД" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Тип</label>
            <select className="input" value={form.type} onChange={e => setField('type', e.target.value)}>
              <option value="COMPANY">ЕООД / АД</option>
              <option value="PERSON">Физическо лице</option>
              <option value="ET">ЕТ</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Марка</label>
            <select className="input" value={form.brand} onChange={e => setField('brand', e.target.value)}>
              <option value="STUDIO_BOTEMA">Studio Botema</option>
              <option value="LUMINAVERA">Luminavera</option>
              <option value="BOTH">И двете</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">ЕИК</label>
            <input className="input" value={form.eik} onChange={e => setField('eik', e.target.value)} placeholder="123456789" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">ДДС номер</label>
            <input className="input" value={form.vat} onChange={e => setField('vat', e.target.value)} placeholder="BG123456789" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">МОЛ</label>
            <input className="input" value={form.mol} onChange={e => setField('mol', e.target.value)} placeholder="Иван Иванов" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Град</label>
            <input className="input" value={form.city} onChange={e => setField('city', e.target.value)} placeholder="София" />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Адрес</label>
            <input className="input" value={form.address} onChange={e => setField('address', e.target.value)} placeholder="ул. Примерна 1" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Имейл</label>
            <input type="email" className="input" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="office@firma.bg" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Телефон</label>
            <input className="input" value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="+359 88 888 8888" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Клиент от</label>
            <input type="date" className="input" value={form.since} onChange={e => setField('since', e.target.value)} />
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
            {mutation.isPending ? 'Запис...' : (existing ? 'Запази' : 'Добави клиент')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const typeLabels: Record<string, string> = {
  COMPANY: 'Фирма', PERSON: 'Физическо лице', ET: 'ЕТ'
};

const brandLabels: Record<string, string> = {
  STUDIO_BOTEMA: 'Studio Botema', LUMINAVERA: 'Luminavera', BOTH: 'И двете'
};

export default function ClientsPage() {
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['clients', brand],
    queryFn: () => api.get(`/clients${brand ? `?brand=${brand}` : ''}`).then(r => r.data),
    staleTime: 30000,
  });

  const clients: Client[] = Array.isArray(data) ? data : (data as any).data || [];

  const filtered = search
    ? clients.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.city?.toLowerCase().includes(search.toLowerCase()) ||
        c.email?.toLowerCase().includes(search.toLowerCase())
      )
    : clients;

  const openEdit = (c: Client) => { setEditing(c); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditing(null); };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Клиенти</h1>
          <p className="text-[#71717a] text-sm mt-0.5">{filtered.length} клиента</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
          <Plus size={15} /> Нов клиент
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <select className="input w-44" value={brand} onChange={e => setBrand(e.target.value)}>
          <option value="">Всички марки</option>
          <option value="STUDIO_BOTEMA">Studio Botema</option>
          <option value="LUMINAVERA">Luminavera</option>
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#52525b]" />
          <input className="input pl-8" placeholder="Търси фирма, имейл, град..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Фирма</th>
              <th className="table-header">Тип</th>
              <th className="table-header">Град</th>
              <th className="table-header">Имейл</th>
              <th className="table-header">Телефон</th>
              <th className="table-header">Марка</th>
              <th className="table-header text-right">Фактури</th>
              <th className="table-header w-12"></th>
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
              <tr><td colSpan={8} className="table-cell text-center text-[#52525b] py-10">Няма клиенти</td></tr>
            ) : (
              filtered.map(c => (
                <tr key={c.id} className="hover:bg-[#1d1d1f] transition-colors">
                  <td className="table-cell font-medium text-white">{c.name}</td>
                  <td className="table-cell text-[#71717a] text-xs">{typeLabels[c.type] || c.type}</td>
                  <td className="table-cell text-[#a1a1aa]">{c.city || '—'}</td>
                  <td className="table-cell text-[#a1a1aa] text-xs">{c.email || '—'}</td>
                  <td className="table-cell text-[#a1a1aa] text-xs">{c.phone || '—'}</td>
                  <td className="table-cell">
                    <span className="text-xs text-[#71717a]">{brandLabels[c.brand || ''] || c.brand || '—'}</span>
                  </td>
                  <td className="table-cell text-right font-semibold text-white">{c.invoiceCount ?? 0}</td>
                  <td className="table-cell">
                    <button
                      onClick={() => openEdit(c)}
                      className="p-1.5 rounded-lg hover:bg-[#27272a] text-[#71717a] hover:text-white transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ClientModal open={modalOpen} onClose={closeModal} existing={editing} />
    </div>
  );
}
