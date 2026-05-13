'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Modal } from '@/components/Modal';

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
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Фактура №</label>
            <input className="input" value={form.invoiceNo} onChange={e => setField('invoiceNo', e.target.value)} placeholder="0000012345" />
          </div>
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Статус</label>
            <select className="input" value={form.status} onChange={e => setField('status', e.target.value)}>
              <option value="PENDING">Чака</option>
              <option value="PAID">Платено</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Сума *</label>
            <input type="number" required min="0" step="0.01" className="input" value={form.amount} onChange={e => setField('amount', e.target.value)} />
          </div>
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Валута</label>
            <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
              <option value="BGN">BGN</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Описание</label>
          <textarea className="input" rows={2} value={form.description} onChange={e => setField('description', e.target.value)} />
        </div>
        {error && (
          <div className="bg-error-container/20 border border-error/30 px-3 py-2">
            <p className="text-error text-body-sm">{error}</p>
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
    currency: 'EUR',
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
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Дата *</label>
            <input type="date" required className="input" value={form.date} onChange={e => setField('date', e.target.value)} />
          </div>
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Фактура №</label>
            <input className="input" value={form.invoiceNo} onChange={e => setField('invoiceNo', e.target.value)} placeholder="0000012345" />
          </div>
        </div>

        <div>
          <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Доставчик *</label>
          <select required className="input" value={form.supplierId} onChange={e => setField('supplierId', e.target.value)}>
            <option value="">— Избери доставчик —</option>
            {(suppliers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Проект</label>
          <select className="input" value={form.projectId} onChange={e => setField('projectId', e.target.value)}>
            <option value="">— Без проект —</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Сума *</label>
            <input type="number" required min="0" step="0.01" className="input" value={form.amount} onChange={e => setField('amount', e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Валута</label>
            <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
              <option value="BGN">BGN</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Статус</label>
          <select className="input" value={form.status} onChange={e => setField('status', e.target.value)}>
            <option value="PENDING">Чака</option>
            <option value="PAID">Платено</option>
          </select>
        </div>

        <div>
          <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Описание</label>
          <textarea className="input" rows={2} value={form.description} onChange={e => setField('description', e.target.value)} placeholder="Описание на доставката..." />
        </div>

        {error && (
          <div className="bg-error-container/20 border border-error/30 px-3 py-2">
            <p className="text-error text-body-sm">{error}</p>
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
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [supplierId, setSupplierId] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editPurchase, setEditPurchase] = useState<Purchase | null>(null);
  const [search, setSearch] = useState('');

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
  const t = useT();

  const purchases: Purchase[] = Array.isArray(data) ? data : (data as any).data || [];

  const filtered = search
    ? purchases.filter(p =>
        (p.supplier?.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (p.invoiceNo || '').toLowerCase().includes(search.toLowerCase()) ||
        (p.description || '').toLowerCase().includes(search.toLowerCase())
      )
    : purchases;

  const total = filtered.reduce((s, p) => s + (p.currency === 'BGN' ? Number(p.amount) / 1.95583 : Number(p.amount)), 0);

  return (
    <div className="p-container-padding">
      <div className="max-w-7xl mx-auto space-y-element-gap">

        {/* Page Title */}
        <div className="flex justify-between items-end mb-8">
          <div>
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-2">{t('pur.label')}</p>
            <h2 className="font-headline text-headline-lg text-on-background">{t('pur.title')}</h2>
            <p className="text-on-surface-variant font-body-md mt-2">
              Manage and reconcile procurement activities across all design entities.
            </p>
          </div>
          <div className="flex gap-4">
            <button className="px-6 py-2 border border-outline text-on-surface font-label-caps text-label-caps hover:bg-surface-container-high transition-colors">
              Export Report
            </button>
            <button
              onClick={() => setModalOpen(true)}
              className="px-6 py-2 bg-primary text-on-primary font-label-caps text-label-caps hover:opacity-90 transition-opacity flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              {t('pur.newPurchase')}
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-surface-container-low p-4 flex flex-wrap items-center gap-gutter border border-outline-variant/10">
          <div className="flex items-center gap-3">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">Year:</span>
            <div className="flex gap-2">
              {[2024, 2025, 2026].map(y => (
                <button
                  key={y}
                  onClick={() => setYear(y)}
                  className={`px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                    year === y
                      ? 'bg-primary-container/20 text-primary-container border border-primary-container/30'
                      : 'bg-surface-container-high text-on-surface-variant border border-transparent hover:border-outline-variant'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
          <div className="h-6 w-px bg-outline-variant/20" />
          <div className="flex items-center gap-3">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">Supplier:</span>
            <select
              className="bg-surface-container-high border-none text-body-sm font-body-sm py-1.5 pl-4 pr-10 text-on-surface focus:ring-1 focus:ring-primary-container"
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
            >
              <option value="">{t('pur.allCompanies')}</option>
              {(suppliers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="h-6 w-px bg-outline-variant/20" />
          <div className="relative">
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
            <input
              className="bg-surface-container-high border-none text-body-sm font-body-sm py-1.5 pl-9 pr-4 text-on-surface focus:ring-1 focus:ring-primary-container w-56"
              placeholder="Търси по доставчик, фактура..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="p-2 text-on-surface-variant hover:text-primary transition-colors">
              <span className="material-symbols-outlined">filter_list</span>
            </button>
            <button className="p-2 text-on-surface-variant hover:text-primary transition-colors">
              <span className="material-symbols-outlined">sort_by_alpha</span>
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-surface-container-low border border-outline-variant/10 overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-surface-container-high">
                {[t('pur.colDate'), t('pur.colSupplier'), t('pur.colInvoice'), t('pur.colAmount'), t('pur.colCurrency'), t('pur.colStatus'), ''].map(h => (
                  <th key={h} className="px-6 py-4 font-label-caps text-label-caps text-on-surface-variant border-b border-outline-variant/10">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5">
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(7)].map((_, j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="h-3 bg-surface-container-high rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-16 text-center text-on-surface-variant font-body-sm">
                    {t('pur.noData')}
                  </td>
                </tr>
              ) : (
                filtered.map(p => {
                  const isPaid = p.status === 'PAID';
                  const isZero = Number(p.amount) === 0;
                  return (
                    <tr key={p.id} className="hover:bg-surface-variant/10 transition-colors group cursor-pointer" onClick={() => router.push(`/purchases/${p.id}`)}>
                      <td className="px-6 py-4 font-data-mono text-data-mono">{fmtDate(p.date)}</td>
                      <td className="px-6 py-4 font-body-md font-semibold text-on-surface">{p.supplier?.name || '—'}</td>
                      <td className="px-6 py-4 text-on-surface-variant">{p.invoiceNo || '—'}</td>
                      <td className={`px-6 py-4 font-data-mono text-data-mono ${isZero ? 'text-error' : 'text-primary'}`}>
                        {fmt(p.amount, p.currency)}
                      </td>
                      <td className="px-6 py-4 font-label-caps text-[12px] text-on-surface-variant">{p.currency}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            isPaid
                              ? 'bg-primary-container shadow-[0_0_8px_rgba(62,144,255,0.4)]'
                              : 'bg-outline'
                          }`} />
                          <span className={`font-label-caps text-label-caps ${isPaid ? 'text-primary-container' : 'text-on-surface-variant'}`}>
                            {isPaid ? 'PAID' : t('pur.pending')}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <button
                          onClick={e => { e.stopPropagation(); setEditPurchase(p); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity material-symbols-outlined text-[20px] text-on-surface-variant hover:text-primary"
                        >
                          more_vert
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Summary Grid */}
        {!isLoading && purchases.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-gutter">
            <div className="bg-surface-container p-6 border border-outline-variant/10 flex flex-col justify-between">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t('pur.totalEur')}</span>
              <div className="mt-4">
                <span className="font-headline text-headline-md text-on-background">
                  {total.toLocaleString('bg-BG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €
                </span>
                <div className="text-xs text-primary mt-1">{purchases.length} фактури за {year} г.</div>
              </div>
            </div>
            <div className="bg-surface-container p-6 border border-outline-variant/10 flex flex-col justify-between">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{t('pur.pending')}</span>
              <div className="mt-4">
                <span className="font-headline text-headline-md text-on-background">
                  {purchases.filter(p => p.status !== 'PAID').length}
                </span>
                <div className="text-xs text-on-surface-variant mt-1">неплатени за {year} г.</div>
              </div>
            </div>
            <div className="bg-surface-container-high p-6 border border-error/20 flex flex-col justify-between">
              <span className="font-label-caps text-label-caps text-error uppercase">{t('pur.zeroAmt')}</span>
              <div className="mt-4">
                <span className="font-headline text-headline-md text-error">
                  {purchases.filter(p => Number(p.amount) === 0).length}
                </span>
                <div className="text-xs text-on-surface-variant mt-1">изискват проверка</div>
              </div>
            </div>
            <div className="bg-surface-container p-6 border border-outline-variant/10 flex flex-col justify-between">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">ДОСТАВЧИЦИ</span>
              <div className="mt-4">
                <span className="font-headline text-headline-md text-on-background">
                  {new Set(purchases.map(p => p.supplier?.id).filter(Boolean)).size}
                </span>
                <div className="text-xs text-on-surface-variant mt-1">уникални доставчика за {year} г.</div>
              </div>
            </div>
          </div>
        )}

      </div>

      <PurchaseModal open={modalOpen} onClose={() => setModalOpen(false)} />
      {editPurchase && <EditPurchaseModal purchase={editPurchase} onClose={() => setEditPurchase(null)} />}
    </div>
  );
}

