'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, fmt, fmtDate } from '@/lib/api';
import { Plus, FileText, Search } from 'lucide-react';

const DOC_TYPES: Record<string, { label: string; icon: string; color: string }> = {
  PROFORMA:      { label: 'Проформа',        icon: 'receipt_long',          color: 'text-primary' },
  OFFER:         { label: 'Оферта',          icon: 'description',           color: 'text-on-surface-variant' },
  PROTOCOL:      { label: 'Протокол',        icon: 'assignment_turned_in',  color: 'text-on-surface-variant' },
  WARRANTY:      { label: 'Гаранция',        icon: 'verified',              color: 'text-primary' },
  DELIVERY_NOTE: { label: 'Доставъчна бел.', icon: 'local_shipping',        color: 'text-on-surface-variant' },
  CREDIT_NOTE:   { label: 'Кредитно изв.',   icon: 'undo',                  color: 'text-error' },
};

const STATUS_COLORS: Record<string, string> = {
  PENDING:   'bg-surface-container-high text-on-surface-variant border-outline-variant/30',
  PAID:      'bg-primary-container/20 text-primary border-primary-container/40',
  OVERDUE:   'bg-error/10 text-error border-error/30',
  CANCELLED: 'bg-error/5 text-error/50 border-error/20',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Чакащ', PAID: 'Платено', OVERDUE: 'Просрочено', CANCELLED: 'Анулиран',
};

export default function IssuedDocsPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState('');

  const params = new URLSearchParams();
  if (typeFilter) params.set('type', typeFilter);
  if (yearFilter) params.set('year', yearFilter);

  const { data, isLoading } = useQuery({
    queryKey: ['issued-docs', typeFilter, yearFilter],
    queryFn: () => api.get(`/issued-docs?${params}&limit=100`).then(r => r.data),
    staleTime: 30000,
  });

  const docs = ((data?.data) || []) as any[];
  const filtered = search
    ? docs.filter(d =>
        d.number?.toLowerCase().includes(search.toLowerCase()) ||
        d.client?.name?.toLowerCase().includes(search.toLowerCase()) ||
        d.description?.toLowerCase().includes(search.toLowerCase())
      )
    : docs;

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-headline text-headline-md text-on-surface">Издадени документи</h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
            Проформи, оферти, протоколи, гаранции
          </p>
        </div>
        <Link href="/issued-docs/new"
          className="btn-primary flex items-center gap-2">
          <Plus size={15} /> Нов документ
        </Link>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-6">
        {Object.entries(DOC_TYPES).map(([type, cfg]) => {
          const count = docs.filter(d => d.type === type).length;
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? '' : type)}
              className={`border p-3 text-left transition-colors ${typeFilter === type ? 'border-primary bg-primary-container/10' : 'border-outline-variant/10 bg-surface-container-low hover:bg-surface-container'}`}
            >
              <span className={`material-symbols-outlined text-[18px] ${cfg.color}`}>{cfg.icon}</span>
              <p className="font-label-caps text-[9px] text-on-surface-variant mt-1">{cfg.label.toUpperCase()}</p>
              <p className="font-headline text-headline-sm text-on-surface">{count}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <select className="input w-44" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
          <option value="">Всички години</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/40" />
          <input
            className="input pl-8"
            placeholder="Търси по номер, клиент..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              {['ТИП', 'НОМЕР', 'ДАТА', 'КЛИЕНТ', 'ПРОЕКТ', 'СУМА', 'СТАТУС', ''].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {[...Array(8)].map((_, j) => (
                    <td key={j} className="table-cell"><div className="h-4 bg-surface-container rounded" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="table-cell text-center py-12 text-on-surface-variant/40">
                  <FileText size={32} className="mx-auto mb-2 opacity-30" />
                  <p>Няма издадени документи</p>
                </td>
              </tr>
            ) : (
              filtered.map((doc: any) => {
                const cfg = DOC_TYPES[doc.type];
                return (
                  <tr key={doc.id} className="hover:bg-surface-container transition-colors">
                    <td className="table-cell">
                      <div className="flex items-center gap-1.5">
                        <span className={`material-symbols-outlined text-[14px] ${cfg?.color || ''}`}>{cfg?.icon || 'article'}</span>
                        <span className="font-label-caps text-[9px] text-on-surface-variant">{cfg?.label || doc.type}</span>
                      </div>
                    </td>
                    <td className="table-cell font-mono text-xs text-on-surface-variant">{doc.number}</td>
                    <td className="table-cell text-on-surface-variant text-xs">{fmtDate(doc.date)}</td>
                    <td className="table-cell font-medium text-on-surface">{doc.client?.name || '—'}</td>
                    <td className="table-cell text-on-surface-variant/60 text-xs">{doc.project?.code || '—'}</td>
                    <td className="table-cell text-right font-semibold text-on-surface">{fmt(doc.amountTotal, doc.currency)}</td>
                    <td className="table-cell">
                      <span className={`inline-flex items-center border px-2 py-0.5 font-label-caps text-[9px] ${STATUS_COLORS[doc.status] || ''}`}>
                        {STATUS_LABELS[doc.status] || doc.status}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex gap-1">
                        <Link href={`/issued-docs/${doc.id}`}
                          className="px-2 py-0.5 text-[10px] border border-outline-variant/30 text-on-surface-variant hover:text-primary hover:border-primary transition-colors">
                          Редакция
                        </Link>
                        <Link href={`/issued-docs/${doc.id}/print`}
                          target="_blank"
                          className="px-2 py-0.5 text-[10px] border border-primary-container/40 text-primary hover:bg-primary-container/10 transition-colors">
                          Принт / PDF
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
