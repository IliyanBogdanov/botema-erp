'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Modal } from '@/components/Modal';

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

const modalLabelClass = 'block font-label-caps text-label-caps text-on-surface-variant mb-1.5';

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
            <label className={modalLabelClass}>Фирма / Имe *</label>
            <input required className="input" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Фирма ЕООД" />
          </div>
          <div>
            <label className={modalLabelClass}>Тип</label>
            <select className="input" value={form.type} onChange={e => setField('type', e.target.value)}>
              <option value="COMPANY">ЕООД / АД</option>
              <option value="PERSON">Физическо лице</option>
              <option value="ET">ЕТ</option>
            </select>
          </div>
          <div>
            <label className={modalLabelClass}>Марка</label>
            <select className="input" value={form.brand} onChange={e => setField('brand', e.target.value)}>
              <option value="STUDIO_BOTEMA">Studio Botema</option>
              <option value="LUMINAVERA">Luminavera</option>
              <option value="BOTH">И двете</option>
            </select>
          </div>
          <div>
            <label className={modalLabelClass}>ЕИК</label>
            <input className="input" value={form.eik} onChange={e => setField('eik', e.target.value)} placeholder="123456789" />
          </div>
          <div>
            <label className={modalLabelClass}>ДДС номер</label>
            <input className="input" value={form.vat} onChange={e => setField('vat', e.target.value)} placeholder="BG123456789" />
          </div>
          <div>
            <label className={modalLabelClass}>МОЛ</label>
            <input className="input" value={form.mol} onChange={e => setField('mol', e.target.value)} placeholder="Иван Иванов" />
          </div>
          <div>
            <label className={modalLabelClass}>Град</label>
            <input className="input" value={form.city} onChange={e => setField('city', e.target.value)} placeholder="София" />
          </div>
          <div className="col-span-2">
            <label className={modalLabelClass}>Адрес</label>
            <input className="input" value={form.address} onChange={e => setField('address', e.target.value)} placeholder="ул. Примерна 1" />
          </div>
          <div>
            <label className={modalLabelClass}>Имейл</label>
            <input type="email" className="input" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="office@firma.bg" />
          </div>
          <div>
            <label className={modalLabelClass}>Телефон</label>
            <input className="input" value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="+359 88 888 8888" />
          </div>
          <div>
            <label className={modalLabelClass}>Клиент от</label>
            <input type="date" className="input" value={form.since} onChange={e => setField('since', e.target.value)} />
          </div>
        </div>

        <div>
          <label className={modalLabelClass}>Бележки</label>
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

function getBrandTabs(t: ReturnType<typeof useT>) {
  return [
    { label: t('clients.allBrands'), value: '' },
    { label: 'Studio Botema', value: 'STUDIO_BOTEMA' },
    { label: 'Luminavera', value: 'LUMINAVERA' },
  ];
}

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
  const t = useT();
  const brandTabs = getBrandTabs(t);

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
    <div className="min-h-screen bg-surface-container-lowest p-container-padding text-on-surface">
      <div className="mx-auto max-w-7xl space-y-section-gap">
        <section className="flex justify-between items-end mb-section-gap">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-2">{t('clients.label')}</p>
            <h2 className="font-headline text-headline-lg text-on-surface">{t('clients.title')}</h2>
          </div>
          <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">add</span>
            {t('clients.new')}
          </button>
        </section>

        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-1 border border-outline-variant/20 bg-surface-container p-1 w-fit">
              {brandTabs.map(tab => (
                <button
                  key={tab.label}
                  onClick={() => setBrand(tab.value)}
                  className={`px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                    brand === tab.value
                      ? 'bg-primary-container text-on-primary-container'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <p className="font-label-caps text-label-caps text-on-surface-variant">{filtered.length} клиента</p>
          </div>

          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">search</span>
            <input
              className="input w-full py-3 pl-12"
              placeholder={t('clients.search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto bg-surface-container-low border border-outline-variant/10">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <th className="table-header">{t('clients.colName')}</th>
                  <th className="table-header">{t('clients.colType')}</th>
                  <th className="table-header">{t('clients.colCity')}</th>
                  <th className="table-header">{t('clients.colEmail')}</th>
                  <th className="table-header">{t('clients.colBrand')}</th>
                  <th className="table-header text-right">{t('clients.colInvoices')}</th>
                  <th className="table-header w-16"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  [...Array(6)].map((_, i) => (
                    <tr key={i} className="animate-pulse hover:bg-surface-container-high">
                      {[...Array(7)].map((_, j) => (
                        <td key={j} className="table-cell"><div className="h-4 rounded bg-surface-container-high" /></td>
                      ))}
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="table-cell py-12 text-center text-on-surface-variant">{t('clients.none')}</td>
                  </tr>
                ) : (
                  filtered.map(c => (
                    <tr key={c.id} className="transition-colors hover:bg-surface-container-high">
                      <td className="table-cell">
                        <Link href={`/clients/${c.id}`} className="group/link block">
                          <p className="font-medium text-on-surface group-hover/link:text-primary transition-colors">{c.name}</p>
                          <p className="mt-1 font-data-mono text-data-mono text-on-surface-variant">{c.phone || '—'}</p>
                        </Link>
                      </td>
                      <td className="table-cell text-on-surface-variant">{typeLabels[c.type] || c.type}</td>
                      <td className="table-cell text-on-surface-variant">{c.city || '—'}</td>
                      <td className="table-cell text-on-surface-variant">{c.email || '—'}</td>
                      <td className="table-cell">
                        <span className="font-label-caps text-label-caps text-on-surface-variant">{brandLabels[c.brand || ''] || c.brand || '—'}</span>
                      </td>
                      <td className="table-cell text-right font-data-mono text-data-mono">{c.invoiceCount ?? 0}</td>
                      <td className="table-cell">
                        <button
                          onClick={() => openEdit(c)}
                          className="ml-auto flex h-9 w-9 items-center justify-center text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                        >
                          <span className="material-symbols-outlined text-[20px]">edit</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <ClientModal open={modalOpen} onClose={closeModal} existing={editing} />
      </div>
    </div>
  );
}
