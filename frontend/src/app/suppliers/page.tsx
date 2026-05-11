'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Modal } from '@/components/Modal';

interface Supplier {
  id: string;
  name: string;
  country?: string;
  currency: string;
  discount?: string;
  email?: string;
  phone?: string;
  notes?: string;
  purchaseCount: number;
  totalSpentEur: number;
  totalSpentBgn: number;
  filteredPurchaseCount: number;
}

const modalLabelClass = 'block font-label-caps text-label-caps text-on-surface-variant mb-1.5';

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
            <label className={modalLabelClass}>Фирма / Марка *</label>
            <input required className="input" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="LODES S.r.l." />
          </div>
          <div>
            <label className={modalLabelClass}>Държава</label>
            <input className="input" value={form.country} onChange={e => setField('country', e.target.value)} placeholder="Италия" />
          </div>
          <div>
            <label className={modalLabelClass}>Валута</label>
            <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
              <option value="EUR">EUR</option>
              <option value="BGN">BGN</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
          <div>
            <label className={modalLabelClass}>Имейл</label>
            <input className="input" type="email" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="info@supplier.com" />
          </div>
          <div>
            <label className={modalLabelClass}>Телефон</label>
            <input className="input" value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="+39 ..." />
          </div>
          <div className="col-span-2">
            <label className={modalLabelClass}>Отстъпка</label>
            <input className="input" value={form.discount} onChange={e => setField('discount', e.target.value)} placeholder="45-50%" />
          </div>
          <div className="col-span-2">
            <label className={modalLabelClass}>Бележки</label>
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

function MetricCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-container-low border border-outline-variant/10 p-5">
      <p className="font-label-caps text-label-caps text-on-surface-variant">{label}</p>
      <p className="mt-3 font-headline text-headline-md text-on-surface">{value}</p>
      {sub && <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant">{sub}</p>}
    </div>
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
  const t = useT();

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

  const totalPurchases = suppliers.reduce((sum, supplier) => sum + (supplier.purchaseCount || 0), 0);
  const totalSpentEur = suppliers.reduce((sum, s) => sum + (s.totalSpentEur || 0), 0);
  const currencies = new Set(suppliers.map(supplier => supplier.currency).filter(Boolean)).size;
  const countryCounts = suppliers.reduce<Record<string, number>>((acc, supplier) => {
    const country = supplier.country?.trim();
    if (country) acc[country] = (acc[country] || 0) + 1;
    return acc;
  }, {});
  const topCountry = Object.entries(countryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

  return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding text-on-surface">
      <div className="mx-auto max-w-7xl space-y-section-gap">
        <section className="flex justify-between items-end mb-section-gap">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-2">{t('sup.label')}</p>
            <h2 className="font-headline text-headline-lg text-on-surface">{t('sup.title')}</h2>
          </div>
          <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">add</span>
            {t('sup.new')}
          </button>
        </section>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label={t('sup.totalSuppliers')} value={String(suppliers.length)} sub={`${filtered.length} видими`} />
          <MetricCard label={t('sup.totalOrders')} value={String(totalPurchases)} sub="общо покупки" />
          <MetricCard label="Общо разходи" value={`€${totalSpentEur.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}`} sub="EUR всички години" />
          <MetricCard label="Водеща държава" value={topCountry} sub="по брой доставчици" />
        </div>

        <div className="space-y-6">
          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">search</span>
            <input
              className="input w-full py-3 pl-12"
              placeholder={t('sup.search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="overflow-x-auto bg-surface-container-low border border-outline-variant/10">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <th className="table-header">{t('sup.colSupplier')}</th>
                  <th className="table-header">{t('sup.colCountry')}</th>
                  <th className="table-header">{t('sup.colCurrency')}</th>
                  <th className="table-header">{t('sup.colDiscount')}</th>
                  <th className="table-header">{t('sup.colEmail')}</th>
                  <th className="table-header text-right">ПОКУПКИ</th>
                  <th className="table-header text-right">ИЗРАЗХОДВАНО EUR</th>
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
                    <td colSpan={7} className="table-cell py-12 text-center text-on-surface-variant">{t('sup.none')}</td>
                  </tr>
                ) : (
                  filtered.map(s => (
                    <tr key={s.id} className="transition-colors hover:bg-surface-container-high">
                      <td className="table-cell">
                        <Link href={`/suppliers/${s.id}`} className="flex items-center gap-3 group/link">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container/10 font-headline text-base text-primary">
                            {s.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-on-surface group-hover/link:text-primary transition-colors">{s.name}</p>
                            <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">{s.phone || '—'}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="table-cell text-on-surface-variant">{s.country || '—'}</td>
                      <td className="table-cell">
                        <span className="font-data-mono text-data-mono text-primary">{s.currency}</span>
                      </td>
                      <td className="table-cell text-on-surface-variant">{s.discount || '—'}</td>
                      <td className="table-cell text-on-surface-variant">{s.email || '—'}</td>
                      <td className="table-cell text-right font-data-mono text-data-mono text-on-surface-variant">{s.purchaseCount || 0}</td>
                      <td className="table-cell text-right">
                        {s.totalSpentEur > 0 ? (
                          <span className="font-mono text-sm font-semibold text-primary">
                            €{s.totalSpentEur.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
                          </span>
                        ) : <span className="text-on-surface-variant/30">—</span>}
                      </td>
                      <td className="table-cell">
                        <button onClick={() => openEdit(s)} className="ml-auto flex h-9 w-9 items-center justify-center text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface">
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

        <SupplierModal open={modalOpen} onClose={closeModal} existing={editing} />
      </div>
    </div>
  );
}
