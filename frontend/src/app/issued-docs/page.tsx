'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api, fmt, fmtDate } from '@/lib/api';
import { FileText } from 'lucide-react';

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
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-outline-variant/10 bg-surface-container-lowest sticky top-0 z-10">
        <div className="px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-0.5">ФИНАНСИ</p>
            <h1 className="font-headline text-headline-lg text-on-surface">Издадени документи</h1>
          </div>
          <Link href="/issued-docs/new"
            className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary font-label-caps text-label-caps hover:bg-primary/90">
            <span className="material-symbols-outlined text-[16px]">add</span>
            Нов документ
          </Link>
        </div>
      </div>

      <div className="px-8 py-6 space-y-4">

      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
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
      <div className="flex gap-3 flex-wrap">
        <select className="border border-outline-variant/30 bg-surface-container-low px-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary w-44" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
          <option value="">Всички години</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <div className="relative flex-1 min-w-[200px]">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant/50 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
          <input
            className="w-full border border-outline-variant/30 bg-surface-container-low pl-9 pr-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary"
            placeholder="Търси по номер, клиент..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
        <div className="overflow-x-auto">
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
      </div>
    </div>
  );
}
