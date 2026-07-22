'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtDate, amountToEur } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Modal } from '@/components/Modal';

interface Purchase {
  id: string;
  docDate: string;
  docNumber?: string;
  amountTotal: number;
  currency: string;
  notes?: string;
  status: string;
  counterpartyId?: string;
  counterparty?: { id: string; name: string };
  project?: { id: string; code: string; name: string };
}

const STATUS_LABELS: Record<string, string> = {
  NEEDS_REVIEW: 'За преглед', REVIEWED: 'Прегледано', MATCHED: 'Платено (банка)', IMPORTED: 'Импортирано',
};

function ProjectCell({ purchase }: { purchase: Purchase }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects').then(r => r.data),
    enabled: editing,
  });
  const mutation = useMutation({
    mutationFn: (projectId: string) => api.patch(`/biz-documents/${purchase.id}/project`, { projectId: projectId || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); setEditing(false); },
  });

  if (editing) {
    return (
      <select
        autoFocus
        className="input py-1 text-xs"
        defaultValue={purchase.project?.id || ''}
        onBlur={() => setEditing(false)}
        onChange={e => mutation.mutate(e.target.value)}
        onClick={e => e.stopPropagation()}
      >
        <option value="">— Без проект —</option>
        {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
      </select>
    );
  }
  return (
    <button
      onClick={e => { e.stopPropagation(); setEditing(true); }}
      className="text-left hover:text-primary transition-colors"
    >
      {purchase.project ? `${purchase.project.code}` : <span className="text-on-surface-variant/40">— задай —</span>}
    </button>
  );
}

function EditPurchaseModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    docNumber: purchase.docNumber || '',
    amountTotal: String(purchase.amountTotal),
    currency: purchase.currency || 'EUR',
    status: purchase.status || 'REVIEWED',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: any) => api.patch(`/biz-documents/${purchase.id}`, payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.error || 'Грешка при запис'),
  });

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open onClose={onClose} title={`Редакция: ${purchase.counterparty?.name || ''}`} size="md">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate({ ...form, amountTotal: Number(form.amountTotal) }); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Фактура №</label>
            <input className="input" value={form.docNumber} onChange={e => setField('docNumber', e.target.value)} placeholder="0000012345" />
          </div>
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Статус</label>
            <select className="input" value={form.status} onChange={e => setField('status', e.target.value)}>
              <option value="NEEDS_REVIEW">За преглед</option>
              <option value="REVIEWED">Прегледано</option>
              <option value="MATCHED">Платено (банка)</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Сума *</label>
            <input type="number" required min="0" step="0.01" className="input" value={form.amountTotal} onChange={e => setField('amountTotal', e.target.value)} />
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
    docDate: new Date().toISOString().slice(0, 10),
    counterpartyId: '',
    projectId: '',
    docNumber: '',
    currency: 'EUR',
    amountTotal: '',
    status: 'REVIEWED',
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
    mutationFn: (payload: any) => api.post('/biz-documents', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchases'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.error || 'Грешка при запис'),
  });

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title="Нова доставка" size="md">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate({ ...form, amountTotal: Number(form.amountTotal) }); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Дата *</label>
            <input type="date" required className="input" value={form.docDate} onChange={e => setField('docDate', e.target.value)} />
          </div>
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Фактура №</label>
            <input className="input" value={form.docNumber} onChange={e => setField('docNumber', e.target.value)} placeholder="0000012345" />
          </div>
        </div>

        <div>
          <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Доставчик *</label>
          <select required className="input" value={form.counterpartyId} onChange={e => setField('counterpartyId', e.target.value)}>
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
            <input type="number" required min="0" step="0.01" className="input" value={form.amountTotal} onChange={e => setField('amountTotal', e.target.value)} placeholder="0.00" />
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
            <option value="NEEDS_REVIEW">За преглед</option>
            <option value="REVIEWED">Прегледано</option>
          </select>
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
  params.set('docType', 'INVOICE_IN');
  if (year) params.set('year', String(year));
  if (supplierId) params.set('counterpartyId', supplierId);

  const { data = [], isLoading } = useQuery({
    queryKey: ['purchases', year, supplierId],
    queryFn: () => api.get(`/biz-documents?${params}`).then(r => r.data),
    staleTime: 30000,
  });
  const t = useT();

  const purchases: Purchase[] = Array.isArray(data) ? data : (data as any).data || [];

  const filtered = search
    ? purchases.filter(p =>
        (p.counterparty?.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (p.docNumber || '').toLowerCase().includes(search.toLowerCase())
      )
    : purchases;

  const total = filtered.reduce((s, p) => s + amountToEur(p.amountTotal, p.currency), 0);

  return (
    <div className="p-container-padding">
      <div className="max-w-7xl mx-auto space-y-element-gap">

        {/* Page Title */}
        <div className="flex justify-between items-end mb-8">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-2">{t('pur.label')}</p>
            <h2 className="font-headline text-headline-lg text-on-surface">{t('pur.title')}</h2>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="px-6 py-2 bg-primary text-on-primary font-label-caps text-label-caps hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            {t('pur.newPurchase')}
          </button>
        </div>

        {/* Filter Bar */}
        <div className="bg-surface-container-low p-4 flex flex-wrap items-center gap-gutter border border-outline-variant/10">
          <div className="flex items-center gap-3">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">Година:</span>
            <div className="flex gap-2">
              {[new Date().getFullYear() - 2, new Date().getFullYear() - 1, new Date().getFullYear()].map(y => (
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
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">Доставчик:</span>
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
        </div>

        {/* Data Table */}
        <div className="bg-surface-container-low border border-outline-variant/10 overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[820px]">
            <thead>
              <tr className="bg-surface-container-high">
                {[t('pur.colDate'), t('pur.colSupplier'), t('pur.colInvoice'), 'Проект', t('pur.colAmount'), t('pur.colCurrency'), t('pur.colStatus'), ''].map(h => (
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
                    {[...Array(8)].map((_, j) => (
                      <td key={j} className="px-6 py-4">
                        <div className="h-3 bg-surface-container-high rounded" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-on-surface-variant font-body-sm">
                    {t('pur.noData')}
                  </td>
                </tr>
              ) : (
                filtered.map(p => {
                  const isMatched = p.status === 'MATCHED';
                  const isZero = Number(p.amountTotal) === 0;
                  return (
                    <tr key={p.id} className="hover:bg-surface-variant/10 transition-colors group cursor-pointer" onClick={() => router.push(`/purchases/${p.id}`)}>
                      <td className="px-6 py-4 font-data-mono text-data-mono">{fmtDate(p.docDate)}</td>
                      <td className="px-6 py-4 font-body-md font-semibold text-on-surface">{p.counterparty?.name || '—'}</td>
                      <td className="px-6 py-4 text-on-surface-variant">{p.docNumber || '—'}</td>
                      <td className="px-6 py-4 font-label-caps text-[12px]" onClick={e => e.stopPropagation()}>
                        <ProjectCell purchase={p} />
                      </td>
                      <td className={`px-6 py-4 font-data-mono text-data-mono ${isZero ? 'text-error' : 'text-primary'}`}>
                        {fmt(p.amountTotal, p.currency)}
                      </td>
                      <td className="px-6 py-4 font-label-caps text-[12px] text-on-surface-variant">{p.currency}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            isMatched
                              ? 'bg-primary-container shadow-[0_0_8px_rgba(62,144,255,0.4)]'
                              : 'bg-outline'
                          }`} />
                          <span className={`font-label-caps text-label-caps ${isMatched ? 'text-primary-container' : 'text-on-surface-variant'}`}>
                            {STATUS_LABELS[p.status] || p.status}
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
                  {purchases.filter(p => p.status !== 'MATCHED').length}
                </span>
                <div className="text-xs text-on-surface-variant mt-1">неплатени за {year} г.</div>
              </div>
            </div>
            <div className="bg-surface-container-high p-6 border border-error/20 flex flex-col justify-between">
              <span className="font-label-caps text-label-caps text-error uppercase">{t('pur.zeroAmt')}</span>
              <div className="mt-4">
                <span className="font-headline text-headline-md text-error">
                  {purchases.filter(p => Number(p.amountTotal) === 0).length}
                </span>
                <div className="text-xs text-on-surface-variant mt-1">изискват проверка</div>
              </div>
            </div>
            <div className="bg-surface-container p-6 border border-outline-variant/10 flex flex-col justify-between">
              <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">ДОСТАВЧИЦИ</span>
              <div className="mt-4">
                <span className="font-headline text-headline-md text-on-background">
                  {new Set(purchases.map(p => p.counterparty?.id).filter(Boolean)).size}
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
