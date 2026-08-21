'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

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
  email?: string;
  phone?: string;
  website?: string;
  logoUrl?: string;
  notes?: string;
  _count?: { bizDocuments: number; payments: number };
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

function CounterpartyAvatar({ cp }: { cp: Counterparty }) {
  if (cp.logoUrl && !cp.isIndividual) {
    return (
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-high border border-outline-variant/20">
        <img
          src={cp.logoUrl}
          alt={cp.name}
          className="h-8 w-8 object-contain"
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <span className="absolute inset-0 flex items-center justify-center font-headline text-base text-on-surface-variant">
          {cleanName(cp.name).charAt(0).toUpperCase()}
        </span>
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
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border font-label-caps text-[10px] ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

export default function CounterpartiesPage() {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [showIndividuals, setShowIndividuals] = useState<'all' | 'companies' | 'individuals'>('all');

  const { data = [], isLoading } = useQuery<Counterparty[]>({
    queryKey: ['counterparties'],
    queryFn: () => api.get('/counterparties').then(r => r.data),
    staleTime: 60000,
  });

  const filtered = data.filter(cp => {
    if (filterType && cp.type !== filterType) return false;
    if (showIndividuals === 'individuals' && !cp.isIndividual) return false;
    if (showIndividuals === 'companies' && cp.isIndividual) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        cp.name.toLowerCase().includes(q) ||
        cp.eik?.includes(q) ||
        cp.vat?.includes(q) ||
        cp.email?.toLowerCase().includes(q) ||
        cp.city?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const typeCounts = data.reduce<Record<string, number>>((acc, cp) => {
    acc[cp.type] = (acc[cp.type] || 0) + 1;
    return acc;
  }, {});

  const individualsCount = data.filter(c => c.isIndividual).length;
  const withLogoCount = data.filter(c => c.logoUrl).length;
  const withEikCount = data.filter(c => c.eik).length;

  return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding text-on-surface">
      <div className="mx-auto max-w-7xl space-y-section-gap">

        {/* Header */}
        <section className="flex justify-between items-end">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-2">ПАРТНЬОРСКА МРЕЖА</p>
            <h2 className="font-headline text-headline-lg text-on-surface">Контрагенти</h2>
            <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
              {data.length} контрагента — клиенти, доставчици, куриери
            </p>
          </div>
        </section>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'ОБЩО', value: String(data.length), icon: 'corporate_fare' },
            { label: 'ФИЗИЧЕСКИ ЛИЦА', value: String(individualsCount), icon: 'person' },
            { label: 'С ЛОГО', value: String(withLogoCount), icon: 'image' },
            { label: 'С ЕИК', value: String(withEikCount), icon: 'badge' },
          ].map(s => (
            <div key={s.label} className="bg-surface-container-low border border-outline-variant/10 p-4 flex items-center gap-3">
              <span className="material-symbols-outlined text-[22px] text-primary">{s.icon}</span>
              <div>
                <p className="font-label-caps text-[9px] text-on-surface-variant tracking-widest">{s.label}</p>
                <p className="font-headline text-headline-sm text-on-surface">{s.value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">search</span>
            <input
              className="input w-full pl-10"
              placeholder="Търси по име, ЕИК, ДДС…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Type filter */}
          <div className="flex gap-1 flex-wrap">
            {ALL_TYPES.map(t => (
              <button
                key={t || 'all'}
                onClick={() => setFilterType(t)}
                className={`px-3 py-1.5 font-label-caps text-[10px] border transition-colors ${
                  filterType === t
                    ? 'bg-primary-container/20 text-primary border-primary/30'
                    : 'text-on-surface-variant border-outline-variant/20 hover:text-on-surface hover:border-outline-variant'
                }`}
              >
                {t ? (TYPE_LABELS[t]?.label || t) : 'Всички'}
                {t && typeCounts[t] ? ` (${typeCounts[t]})` : ''}
              </button>
            ))}
          </div>

          {/* Individual/company filter */}
          <div className="flex gap-1">
            {([['all', 'Всички'], ['companies', 'Фирми'], ['individuals', 'Физ. лица']] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setShowIndividuals(val)}
                className={`px-3 py-1.5 font-label-caps text-[10px] border transition-colors ${
                  showIndividuals === val
                    ? 'bg-amber-400/10 text-amber-300 border-amber-400/30'
                    : 'text-on-surface-variant border-outline-variant/20 hover:text-on-surface'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <span className="ml-auto font-label-caps text-[10px] text-on-surface-variant">
            {filtered.length} резултата
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto bg-surface-container-low border border-outline-variant/10">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr>
                <th className="table-header w-14"></th>
                <th className="table-header">ИМЕ</th>
                <th className="table-header">ТИП</th>
                <th className="table-header">ДЪРЖАВА</th>
                <th className="table-header">ЕИК / ДДС №</th>
                <th className="table-header">ИМЕЙЛ</th>
                <th className="table-header text-right">ДОКУМЕНТИ</th>
                <th className="table-header text-right">ПЛАЩАНИЯ</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [...Array(8)].map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {[...Array(8)].map((_, j) => (
                      <td key={j} className="table-cell">
                        <div className="h-4 rounded bg-surface-container-high" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-cell py-16 text-center text-on-surface-variant">
                    <span className="material-symbols-outlined text-[40px] block mb-2 text-outline">corporate_fare</span>
                    Няма намерени контрагенти
                  </td>
                </tr>
              ) : (
                filtered.map(cp => (
                  <tr key={cp.id} className="transition-colors hover:bg-surface-container-high">
                    <td className="table-cell pl-4">
                      <CounterpartyAvatar cp={cp} />
                    </td>
                    <td className="table-cell">
                      <div>
                        <p className="font-medium text-on-surface flex items-center gap-2">
                          {cleanName(cp.name)}
                          {cp.isIndividual && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-400/30 bg-amber-400/10 font-label-caps text-[9px] text-amber-300">
                              физ. лице
                            </span>
                          )}
                        </p>
                        {cp.city && (
                          <p className="mt-0.5 font-body-sm text-body-sm text-on-surface-variant">{cp.city}</p>
                        )}
                      </div>
                    </td>
                    <td className="table-cell">
                      <TypeChip type={cp.type} />
                    </td>
                    <td className="table-cell">
                      <span className="font-data-mono text-data-mono text-on-surface-variant">{cp.country}</span>
                    </td>
                    <td className="table-cell">
                      <div className="space-y-0.5">
                        {cp.eik && (
                          <p className="font-data-mono text-[11px] text-on-surface">ЕИК: {cp.eik}</p>
                        )}
                        {cp.vat && (
                          <p className="font-data-mono text-[11px] text-primary">{cp.vat}</p>
                        )}
                        {!cp.eik && !cp.vat && (
                          <span className="text-on-surface-variant/30 text-sm">—</span>
                        )}
                      </div>
                    </td>
                    <td className="table-cell text-on-surface-variant font-body-sm text-body-sm">
                      {cp.email || '—'}
                    </td>
                    <td className="table-cell text-right">
                      <span className="font-data-mono text-data-mono text-on-surface-variant">
                        {cp._count?.bizDocuments ?? 0}
                      </span>
                    </td>
                    <td className="table-cell text-right">
                      <span className="font-data-mono text-data-mono text-on-surface-variant">
                        {cp._count?.payments ?? 0}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
