'use client';
import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Modal } from '@/components/Modal';

interface Counterparty {
  id: string;
  name: string;
  type: string;
  isIndividual: boolean;
  eik?: string;
  vat?: string;
  country: string;
  currency: string;
  city?: string;
  address?: string;
  email?: string;
  phone?: string;
  website?: string;
  logoUrl?: string;
  notes?: string;
  mol?: string;
  since?: number;
  clientType?: string;
  brand?: string;
  _count?: { bizDocuments: number; payments: number };
  // enrichment (present when filtered by type=SUPPLIER/CLIENT)
  purchaseCount?: number; totalSpentEur?: number; paidEur?: number; gapEur?: number;
  invoiceCount?: number; totalRevenueBGN?: number;
}

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  CLIENT:     { label: 'Клиент',     color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' },
  SUPPLIER:   { label: 'Доставчик',  color: 'text-primary bg-primary/10 border-primary/20' },
  COURIER:    { label: 'Куриер',     color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20' },
  BANK:       { label: 'Банка',      color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' },
  ACCOUNTING: { label: 'Счетоводство', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20' },
  DESIGNER:   { label: 'Дизайнер/архитект', color: 'text-pink-400 bg-pink-400/10 border-pink-400/20' },
  OTHER:      { label: 'Друго',      color: 'text-on-surface-variant bg-surface-container border-outline-variant/20' },
};
const ALL_TYPES = ['', 'CLIENT', 'SUPPLIER', 'COURIER', 'BANK', 'ACCOUNTING', 'DESIGNER', 'OTHER'];
const cleanName = (n: string) => n?.replace(/^"|"$/g, '').trim() || n;
const modalLabelClass = 'block font-label-caps text-label-caps text-on-surface-variant mb-1.5';

function CounterpartyModal({ open, onClose, existing }: { open: boolean; onClose: () => void; existing?: Counterparty | null }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: existing?.name || '',
    type: existing?.type || 'CLIENT',
    isIndividual: existing?.isIndividual || false,
    eik: existing?.eik || '',
    vat: existing?.vat || '',
    country: existing?.country || 'BG',
    currency: existing?.currency || 'BGN',
    address: existing?.address || '',
    city: existing?.city || '',
    email: existing?.email || '',
    phone: existing?.phone || '',
    mol: existing?.mol || '',
    clientType: existing?.clientType || 'COMPANY',
    brand: existing?.brand || 'STUDIO_BOTEMA',
    notes: existing?.notes || '',
  });
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: any) =>
      existing ? api.patch(`/counterparties/${existing.id}`, payload) : api.post('/counterparties', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['counterparties'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.error || 'Грешка при запис'),
  });

  const setField = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));
  const isClient = form.type === 'CLIENT';
  const isSupplier = form.type === 'SUPPLIER';

  return (
    <Modal open={open} onClose={onClose} title={existing ? 'Редактирай контрагент' : 'Нов контрагент'} size="lg">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate(form); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={modalLabelClass}>Име / Фирма *</label>
            <input required className="input" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Фирма ЕООД" />
          </div>
          <div>
            <label className={modalLabelClass}>Тип *</label>
            <select className="input" value={form.type} onChange={e => setField('type', e.target.value)}>
              {ALL_TYPES.filter(Boolean).map(t => <option key={t} value={t}>{TYPE_LABELS[t].label}</option>)}
            </select>
          </div>
          {isClient && (
            <div>
              <label className={modalLabelClass}>Вид клиент</label>
              <select className="input" value={form.clientType} onChange={e => setField('clientType', e.target.value)}>
                <option value="COMPANY">ЕООД / АД</option>
                <option value="PERSON">Физическо лице</option>
                <option value="ET">ЕТ</option>
              </select>
            </div>
          )}
          {!isClient && (
            <div>
              <label className={modalLabelClass}>Физическо лице?</label>
              <select className="input" value={form.isIndividual ? '1' : '0'} onChange={e => setField('isIndividual', e.target.value === '1')}>
                <option value="0">Не</option>
                <option value="1">Да</option>
              </select>
            </div>
          )}
          <div>
            <label className={modalLabelClass}>ЕИК</label>
            <input className="input" value={form.eik} onChange={e => setField('eik', e.target.value)} placeholder="123456789" />
          </div>
          <div>
            <label className={modalLabelClass}>ДДС номер</label>
            <input className="input" value={form.vat} onChange={e => setField('vat', e.target.value)} placeholder="BG123456789" />
          </div>
          {isClient && (
            <div>
              <label className={modalLabelClass}>МОЛ</label>
              <input className="input" value={form.mol} onChange={e => setField('mol', e.target.value)} placeholder="Иван Иванов" />
            </div>
          )}
          <div>
            <label className={modalLabelClass}>{isSupplier ? 'Държава' : 'Град'}</label>
            <input className="input" value={isSupplier ? form.country : form.city} onChange={e => setField(isSupplier ? 'country' : 'city', e.target.value)} placeholder={isSupplier ? 'Италия' : 'София'} />
          </div>
          {isSupplier && (
            <div>
              <label className={modalLabelClass}>Валута</label>
              <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
                <option value="EUR">EUR</option><option value="BGN">BGN</option><option value="USD">USD</option><option value="GBP">GBP</option>
              </select>
            </div>
          )}
          {!isSupplier && (
            <div className="col-span-2">
              <label className={modalLabelClass}>Адрес</label>
              <input className="input" value={form.address} onChange={e => setField('address', e.target.value)} placeholder="ул. Примерна 1" />
            </div>
          )}
          <div>
            <label className={modalLabelClass}>Имейл</label>
            <input type="email" className="input" value={form.email} onChange={e => setField('email', e.target.value)} placeholder="office@firma.bg" />
          </div>
          <div>
            <label className={modalLabelClass}>Телефон</label>
            <input className="input" value={form.phone} onChange={e => setField('phone', e.target.value)} placeholder="+359 88 888 8888" />
          </div>
          {isClient && (
            <div className="col-span-2">
              <label className={modalLabelClass}>Марка (канал за фактурите)</label>
              <select className="input" value={form.brand} onChange={e => setField('brand', e.target.value)}>
                <option value="STUDIO_BOTEMA">Studio Botema</option>
                <option value="LUMINAVERA">Luminavera (онлайн магазин)</option>
              </select>
            </div>
          )}
        </div>

        <div>
          <label className={modalLabelClass}>Бележки</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} />
        </div>

        {error && (
          <div className="bg-error/10 border border-error/30 rounded-lg px-3 py-2">
            <p className="text-error text-sm">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Отказ</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
            {mutation.isPending ? 'Запис...' : (existing ? 'Запази' : 'Добави')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CounterpartyAvatar({ cp }: { cp: Counterparty }) {
  if (cp.logoUrl && !cp.isIndividual) {
    return (
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high border border-outline-variant/20">
        <img src={cp.logoUrl} alt={cp.name} className="h-8 w-8 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        <span className="absolute inset-0 flex items-center justify-center font-headline text-base text-on-surface-variant">{cleanName(cp.name).charAt(0).toUpperCase()}</span>
      </div>
    );
  }
  if (cp.isIndividual) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400/10 border border-amber-400/20 font-headline text-base text-amber-300">
        <span className="material-symbols-outlined text-[20px]">person</span>
      </div>
    );
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container/10 border border-primary/10 font-headline text-base text-primary">
      {cleanName(cp.name).charAt(0).toUpperCase()}
    </div>
  );
}

function TypeChip({ type }: { type: string }) {
  const cfg = TYPE_LABELS[type] || TYPE_LABELS.OTHER;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded border font-label-caps text-[10px] ${cfg.color}`}>{cfg.label}</span>;
}

export default function CounterpartiesPage() {
  return (
    <Suspense fallback={null}>
      <CounterpartiesPageInner />
    </Suspense>
  );
}

function CounterpartiesPageInner() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState(searchParams.get('type') || '');
  const [showIndividuals, setShowIndividuals] = useState<'all' | 'companies' | 'individuals'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Counterparty | null>(null);
  const [mergeMode, setMergeMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const { data = [], isLoading } = useQuery<Counterparty[]>({
    queryKey: ['counterparties', filterType],
    queryFn: () => api.get(`/counterparties${filterType ? `?type=${filterType}` : ''}`).then(r => r.data),
    staleTime: 30000,
  });

  const merge = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => api.post(`/counterparties/${from}/merge-into/${to}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['counterparties'] }); setSelected([]); setMergeMode(false); },
  });

  const filtered = data.filter(cp => {
    if (showIndividuals === 'individuals' && !cp.isIndividual) return false;
    if (showIndividuals === 'companies' && cp.isIndividual) return false;
    if (search) {
      const q = search.toLowerCase();
      return cp.name.toLowerCase().includes(q) || cp.eik?.includes(q) || cp.vat?.includes(q) || cp.email?.toLowerCase().includes(q) || cp.city?.toLowerCase().includes(q);
    }
    return true;
  });

  const typeCounts = data.reduce<Record<string, number>>((acc, cp) => { acc[cp.type] = (acc[cp.type] || 0) + 1; return acc; }, {});
  const openEdit = (cp: Counterparty) => { setEditing(cp); setModalOpen(true); };
  const closeModal = () => { setModalOpen(false); setEditing(null); };

  const toggleSelect = (id: string) => {
    setSelected(sel => sel.includes(id) ? sel.filter(s => s !== id) : sel.length < 2 ? [...sel, id] : [sel[1], id]);
  };
  const selectedRows = selected.map(id => data.find(d => d.id === id)).filter(Boolean) as Counterparty[];

  const supplierTotals = filterType === 'SUPPLIER' ? {
    spent: filtered.reduce((s, c) => s + (c.totalSpentEur || 0), 0),
    paid: filtered.reduce((s, c) => s + (c.paidEur || 0), 0),
  } : null;
  const clientTotals = filterType === 'CLIENT' ? {
    revenue: filtered.reduce((s, c) => s + (c.totalRevenueBGN || 0), 0) / 1.95583,
    invoices: filtered.reduce((s, c) => s + (c.invoiceCount || 0), 0),
  } : null;

  return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding text-on-surface">
      <div className="mx-auto max-w-7xl space-y-section-gap">

        <section className="flex justify-between items-end flex-wrap gap-3">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-2">ПАРТНЬОРСКА МРЕЖА</p>
            <h2 className="font-headline text-headline-lg text-on-surface">Контрагенти</h2>
            <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">{data.length} контрагента — клиенти, доставчици, куриери, дизайнери</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setMergeMode(m => !m); setSelected([]); }}
              className={`btn-ghost flex items-center gap-2 ${mergeMode ? 'text-primary' : ''}`}
            >
              <span className="material-symbols-outlined text-[18px]">call_merge</span>
              {mergeMode ? 'Откажи сливане' : 'Обедини дублирани'}
            </button>
            <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
              <span className="material-symbols-outlined text-[20px]">add</span>
              Нов контрагент
            </button>
          </div>
        </section>

        {mergeMode && (
          <div className="flex items-center gap-3 border border-primary/30 bg-primary/5 px-4 py-3">
            <span className="material-symbols-outlined text-primary text-[18px]">info</span>
            <p className="font-body-sm text-body-sm text-on-surface flex-1">
              Избери двама дублирани контрагенти (кликни редовете). Всички документи/плащания/фактури се пренасочват към втория избран, а първият се трие.
            </p>
            {selectedRows.length === 2 && (
              <button
                disabled={merge.isPending}
                onClick={() => merge.mutate({ from: selectedRows[0].id, to: selectedRows[1].id })}
                className="btn-primary flex items-center gap-2 whitespace-nowrap disabled:opacity-50"
              >
                {merge.isPending ? 'Сливам...' : `Обедини "${selectedRows[0].name}" → "${selectedRows[1].name}"`}
              </button>
            )}
          </div>
        )}

        {supplierTotals && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-surface-container-low border border-outline-variant/10 p-4"><p className="font-label-caps text-[9px] text-on-surface-variant">ДОСТАВЧИЦИ</p><p className="mt-1 font-headline text-headline-sm">{filtered.length}</p></div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-4"><p className="font-label-caps text-[9px] text-on-surface-variant">ДОКУМЕНТИРАНО €</p><p className="mt-1 font-headline text-headline-sm text-primary">{supplierTotals.spent.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}</p></div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-4"><p className="font-label-caps text-[9px] text-on-surface-variant">ПЛАТЕНО €</p><p className="mt-1 font-headline text-headline-sm text-emerald-400">{supplierTotals.paid.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}</p></div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-4"><p className="font-label-caps text-[9px] text-on-surface-variant">РАЗЛИКА €</p><p className="mt-1 font-headline text-headline-sm text-warning">{(supplierTotals.spent - supplierTotals.paid).toLocaleString('bg-BG', { maximumFractionDigits: 0 })}</p></div>
          </div>
        )}
        {clientTotals && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-surface-container-low border border-outline-variant/10 p-4"><p className="font-label-caps text-[9px] text-on-surface-variant">КЛИЕНТИ</p><p className="mt-1 font-headline text-headline-sm">{filtered.length}</p></div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-4"><p className="font-label-caps text-[9px] text-on-surface-variant">ПРИХОДИ €</p><p className="mt-1 font-headline text-headline-sm text-primary">{clientTotals.revenue.toLocaleString('bg-BG', { maximumFractionDigits: 0 })}</p></div>
            <div className="bg-surface-container-low border border-outline-variant/10 p-4"><p className="font-label-caps text-[9px] text-on-surface-variant">ФАКТУРИ</p><p className="mt-1 font-headline text-headline-sm">{clientTotals.invoices}</p></div>
          </div>
        )}

        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">search</span>
            <input className="input w-full pl-10" placeholder="Търси по име, ЕИК, ДДС…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="flex gap-1 flex-wrap">
            {ALL_TYPES.map(t => (
              <button key={t || 'all'} onClick={() => setFilterType(t)}
                className={`px-3 py-1.5 font-label-caps text-[10px] border transition-colors ${filterType === t ? 'bg-primary-container/20 text-primary border-primary/30' : 'text-on-surface-variant border-outline-variant/20 hover:text-on-surface hover:border-outline-variant'}`}>
                {t ? (TYPE_LABELS[t]?.label || t) : 'Всички'}{t && typeCounts[t] ? ` (${typeCounts[t]})` : ''}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {([['all', 'Всички'], ['companies', 'Фирми'], ['individuals', 'Физ. лица']] as const).map(([val, label]) => (
              <button key={val} onClick={() => setShowIndividuals(val)}
                className={`px-3 py-1.5 font-label-caps text-[10px] border transition-colors ${showIndividuals === val ? 'bg-amber-400/10 text-amber-300 border-amber-400/30' : 'text-on-surface-variant border-outline-variant/20 hover:text-on-surface'}`}>
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto font-label-caps text-[10px] text-on-surface-variant">{filtered.length} резултата</span>
        </div>

        <div className="overflow-x-auto bg-surface-container-low border border-outline-variant/10">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr>
                <th className="table-header w-14"></th>
                <th className="table-header">ИМЕ</th>
                <th className="table-header">ТИП</th>
                <th className="table-header">ДЪРЖАВА</th>
                <th className="table-header">ЕИК / ДДС №</th>
                <th className="table-header">ИМЕЙЛ</th>
                <th className="table-header text-right">ДОКУМЕНТИ</th>
                <th className="table-header w-16"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="animate-pulse">{[...Array(8)].map((_, j) => <td key={j} className="table-cell"><div className="h-4 rounded bg-surface-container-high" /></td>)}</tr>
                ))
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="table-cell py-16 text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-[40px] block mb-2 text-outline">corporate_fare</span>
                  Няма намерени контрагенти
                </td></tr>
              ) : (
                filtered.map(cp => {
                  const isSelected = selected.includes(cp.id);
                  return (
                    <tr key={cp.id} className={`transition-colors hover:bg-surface-container-high ${isSelected ? 'bg-primary-container/10' : ''} ${mergeMode ? 'cursor-pointer' : ''}`}
                      onClick={mergeMode ? () => toggleSelect(cp.id) : undefined}>
                      <td className="table-cell pl-4"><CounterpartyAvatar cp={cp} /></td>
                      <td className="table-cell">
                        {mergeMode ? (
                          <div>
                            <p className="font-medium text-on-surface flex items-center gap-2">
                              {isSelected && <span className="material-symbols-outlined text-[16px] text-primary">check_circle</span>}
                              {cleanName(cp.name)}
                            </p>
                            {cp.city && <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{cp.city}</p>}
                          </div>
                        ) : (
                          <Link href={`/counterparties/${cp.id}`} className="group/link block">
                            <p className="font-medium text-on-surface group-hover/link:text-primary transition-colors flex items-center gap-2">
                              {cleanName(cp.name)}
                              {cp.isIndividual && <span className="inline-flex items-center px-1.5 py-0.5 rounded border border-amber-400/30 bg-amber-400/10 font-label-caps text-[9px] text-amber-300">физ. лице</span>}
                            </p>
                            {cp.city && <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{cp.city}</p>}
                          </Link>
                        )}
                      </td>
                      <td className="table-cell"><TypeChip type={cp.type} /></td>
                      <td className="table-cell"><span className="font-data-mono text-data-mono text-on-surface-variant">{cp.country}</span></td>
                      <td className="table-cell">
                        <div className="space-y-0.5">
                          {cp.eik && <p className="font-data-mono text-[11px] text-on-surface">ЕИК: {cp.eik}</p>}
                          {cp.vat && <p className="font-data-mono text-[11px] text-primary">{cp.vat}</p>}
                          {!cp.eik && !cp.vat && <span className="text-on-surface-variant/30 text-sm">—</span>}
                        </div>
                      </td>
                      <td className="table-cell text-on-surface-variant font-body-sm text-body-sm">{cp.email || '—'}</td>
                      <td className="table-cell text-right"><span className="font-data-mono text-data-mono text-on-surface-variant">{cp._count?.bizDocuments ?? 0}</span></td>
                      <td className="table-cell">
                        {!mergeMode && (
                          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); openEdit(cp); }}
                            className="ml-auto flex h-9 w-9 items-center justify-center text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface">
                            <span className="material-symbols-outlined text-[20px]">edit</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <CounterpartyModal open={modalOpen} onClose={closeModal} existing={editing} />
      </div>
    </div>
  );
}
