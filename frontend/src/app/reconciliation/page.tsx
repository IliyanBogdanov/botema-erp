'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';
import { useT } from '@/lib/i18n';

// Link type labels
const LINK_TYPE_LABELS: Record<string, { bg: string; en: string; icon: string; color: string }> = {
  PAYMENT_TO_INVOICE:   { bg: 'Плащане → Фактура', en: 'Payment → Invoice', icon: 'payments', color: 'text-primary' },
  INVOICE_TO_DELIVERY:  { bg: 'Фактура → Доставка', en: 'Invoice → Delivery', icon: 'local_shipping', color: 'text-on-surface' },
  DELIVERY_TO_ORDER:    { bg: 'Доставка → Поръчка', en: 'Delivery → Order', icon: 'inventory_2', color: 'text-on-surface-variant' },
  ORDER_TO_PROJECT:     { bg: 'Поръчка → Проект', en: 'Order → Project', icon: 'folder_open', color: 'text-warning' },
  DOCUMENT_TO_PURCHASE: { bg: 'Документ → Покупка', en: 'Document → Purchase', icon: 'receipt', color: 'text-primary' },
  DOCUMENT_TO_INVOICE:  { bg: 'Документ → Фактура', en: 'Document → Invoice', icon: 'receipt_long', color: 'text-primary' },
};

const MISSING_TYPE_LABELS: Record<string, string> = {
  ADVANCE_INVOICE: 'Авансова фактура',
  INVOICE: 'Фактура',
  DELIVERY_NOTE: 'Приемно-предавателен протокол',
  PAYMENT_PROOF: 'Платежно нареждане',
  CONTRACT: 'Договор',
  OTHER: 'Друго',
};

const DOC_TYPE_ICONS: Record<string, string> = {
  INVOICE_IN: 'receipt',
  INVOICE_OUT: 'receipt_long',
  DELIVERY: 'local_shipping',
  ORDER: 'inventory_2',
  CONTRACT: 'description',
  PAYMENT: 'payments',
  BANK: 'account_balance',
  OTHER: 'folder',
};

function DocTypeChip({ type }: { type: string }) {
  const icon = DOC_TYPE_ICONS[type] || 'folder';
  return (
    <span className="inline-flex items-center gap-1 bg-surface-container-high border border-outline-variant/10 px-2 py-0.5 font-label-caps text-[9px] text-on-surface-variant">
      <span className="material-symbols-outlined text-[12px]">{icon}</span>
      {type}
    </span>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    HIGH: 'bg-error',
    MEDIUM: 'bg-warning',
    LOW: 'bg-primary-container',
  };
  return <span className={`w-2 h-2 rounded-full inline-block ${colors[severity] || 'bg-outline-variant'}`} />;
}

function LinkTypeTab({ type, count, active, onClick }: { type: string; count: number; active: boolean; onClick: () => void }) {
  const cfg = LINK_TYPE_LABELS[type] || { bg: type, icon: 'link', color: 'text-on-surface-variant' };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 font-label-caps text-label-caps transition-colors border-b-2 -mb-px whitespace-nowrap ${
        active ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
      }`}
    >
      <span className="material-symbols-outlined text-[16px]">{cfg.icon}</span>
      {cfg.bg}
      <span className="text-[9px] opacity-60 ml-1">{count}</span>
    </button>
  );
}

export default function ReconciliationPage() {
  const t = useT();
  const [tab, setTab] = useState<'links' | 'missing' | 'coverage'>('links');
  const [linkTypeFilter, setLinkTypeFilter] = useState('');

  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: ['reconciliation-links', linkTypeFilter],
    queryFn: () => api.get(`/reconciliation${linkTypeFilter ? `?linkType=${linkTypeFilter}` : ''}`).then(r => r.data),
  });

  const { data: missing = [], isLoading: missingLoading } = useQuery({
    queryKey: ['reconciliation-missing'],
    queryFn: () => api.get('/reconciliation/missing').then(r => r.data),
  });

  const { data: coverage = [] } = useQuery({
    queryKey: ['reconciliation-coverage'],
    queryFn: () => api.get('/reconciliation/coverage').then(r => r.data),
  });

  // Group links by type for tabs
  const linksByType = (links as any[]).reduce((acc: Record<string, number>, l: any) => {
    acc[l.linkType] = (acc[l.linkType] || 0) + 1;
    return acc;
  }, {});

  const linkTypes = Object.keys(LINK_TYPE_LABELS);

  const filteredLinks = linkTypeFilter
    ? (links as any[]).filter((l: any) => l.linkType === linkTypeFilter)
    : (links as any[]);

  const missingSeverityCounts = (missing as any[]).reduce((acc: Record<string, number>, m: any) => {
    acc[m.severity || 'LOW'] = (acc[m.severity || 'LOW'] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="min-h-screen">
      {/* ── HEADER ────────────────────────────────────────────────────────────── */}
      <div className="border-b border-outline-variant/10 bg-surface-container-lowest sticky top-0 z-10">
        <div className="px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-0.5">ДОКУМЕНТАЛЕН ОДИТ</p>
            <h1 className="font-headline text-headline-lg text-on-surface">Reconciliation</h1>
          </div>
          <div className="flex items-center gap-2 text-on-surface-variant/60">
            <span className="material-symbols-outlined text-[18px]">link</span>
            <span className="font-label-caps text-label-caps">{(links as any[]).length} връзки</span>
            {(missing as any[]).length > 0 && (
              <>
                <span className="w-1 h-1 rounded-full bg-outline-variant mx-1" />
                <span className="material-symbols-outlined text-[16px] text-warning">warning</span>
                <span className="font-label-caps text-label-caps text-warning">{(missing as any[]).length} липсващи</span>
              </>
            )}
          </div>
        </div>

        {/* main tabs */}
        <div className="px-8 flex gap-0 border-t border-outline-variant/5">
          {[
            { key: 'links', icon: 'account_tree', label: 'Документни вериги', count: (links as any[]).length },
            { key: 'missing', icon: 'report_problem', label: 'Липсващи документи', count: (missing as any[]).length },
            { key: 'coverage', icon: 'fact_check', label: 'Покритие', count: (coverage as any[]).length },
          ].map(item => (
            <button
              key={item.key}
              onClick={() => setTab(item.key as any)}
              className={`flex items-center gap-2 px-5 py-3 font-label-caps text-label-caps transition-colors border-b-2 -mb-px ${
                tab === item.key ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
              {item.label}
              <span className="text-[9px] opacity-60">{item.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 py-6">

        {/* ── TAB: LINKS ─────────────────────────────────────────────────────── */}
        {tab === 'links' && (
          <div className="space-y-4">
            {/* link type filter row */}
            <div className="flex gap-1 flex-wrap border-b border-outline-variant/5 pb-3 overflow-x-auto">
              <button
                onClick={() => setLinkTypeFilter('')}
                className={`px-3 py-1.5 font-label-caps text-label-caps transition-colors ${
                  !linkTypeFilter ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface border border-outline-variant/20'
                }`}
              >
                Всички ({(links as any[]).length})
              </button>
              {linkTypes.filter(t => linksByType[t]).map(type => (
                <button
                  key={type}
                  onClick={() => setLinkTypeFilter(type)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 font-label-caps text-label-caps transition-colors ${
                    linkTypeFilter === type ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface border border-outline-variant/20'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">{LINK_TYPE_LABELS[type]?.icon || 'link'}</span>
                  {LINK_TYPE_LABELS[type]?.bg || type}
                  <span className="opacity-60">({linksByType[type]})</span>
                </button>
              ))}
            </div>

            {linksLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-surface-container-low border border-outline-variant/10 animate-pulse" />)}
              </div>
            ) : filteredLinks.length === 0 ? (
              <div className="py-16 text-center">
                <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 block mb-3">link_off</span>
                <p className="font-body-sm text-body-sm text-on-surface-variant/60">Няма документни връзки</p>
              </div>
            ) : (
              <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header">ТИП ВРЪЗКА</th>
                      <th className="table-header">ИЗХОДЕН ДОКУМЕНТ</th>
                      <th className="table-header">→</th>
                      <th className="table-header">ЦЕЛЕВИ ДОКУМЕНТ</th>
                      <th className="table-header">ПЛАЩАНЕ</th>
                      <th className="table-header">ДАТА</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLinks.slice(0, 50).map((link: any) => {
                      const cfg = LINK_TYPE_LABELS[link.linkType] || { bg: link.linkType, icon: 'link', color: 'text-on-surface-variant' };
                      return (
                        <tr key={link.id} className="hover:bg-surface-container transition-colors">
                          <td className="table-cell">
                            <div className="flex items-center gap-2">
                              <span className={`material-symbols-outlined text-[16px] ${cfg.color}`}>{cfg.icon}</span>
                              <span className="font-label-caps text-[9px] text-on-surface-variant">{cfg.bg}</span>
                            </div>
                          </td>
                          <td className="table-cell">
                            {link.sourceDoc ? (
                              <div>
                                <DocTypeChip type={link.sourceDoc.docType} />
                                {link.sourceDoc.docNumber && (
                                  <p className="font-mono text-[10px] text-on-surface-variant/60 mt-0.5">{link.sourceDoc.docNumber}</p>
                                )}
                              </div>
                            ) : <span className="text-on-surface-variant/30">—</span>}
                          </td>
                          <td className="table-cell text-center">
                            <span className="material-symbols-outlined text-[14px] text-on-surface-variant/30">arrow_forward</span>
                          </td>
                          <td className="table-cell">
                            {link.targetDoc ? (
                              <div>
                                <DocTypeChip type={link.targetDoc.docType} />
                                {link.targetDoc.docNumber && (
                                  <p className="font-mono text-[10px] text-on-surface-variant/60 mt-0.5">{link.targetDoc.docNumber}</p>
                                )}
                              </div>
                            ) : <span className="text-on-surface-variant/30">—</span>}
                          </td>
                          <td className="table-cell">
                            {link.payment ? (
                              <span className="font-semibold text-primary text-sm">
                                {fmt(link.payment.amount, link.payment.currency)}
                              </span>
                            ) : <span className="text-on-surface-variant/30">—</span>}
                          </td>
                          <td className="table-cell text-on-surface-variant/60 text-xs">
                            {fmtDate(link.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredLinks.length > 50 && (
                  <div className="px-4 py-3 border-t border-outline-variant/5 text-center">
                    <span className="font-label-caps text-label-caps text-on-surface-variant/40">Показани 50 от {filteredLinks.length}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── TAB: MISSING ───────────────────────────────────────────────────── */}
        {tab === 'missing' && (
          <div className="space-y-4">
            {/* severity summary */}
            {(missing as any[]).length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                {(['HIGH', 'MEDIUM', 'LOW'] as const).map(sev => {
                  const count = missingSeverityCounts[sev] || 0;
                  const colors: Record<string, string> = {
                    HIGH: 'border-error/30 bg-error/5',
                    MEDIUM: 'border-warning/30 bg-warning/5',
                    LOW: 'border-outline-variant/20 bg-surface-container-low',
                  };
                  const labels: Record<string, string> = { HIGH: 'КРИТИЧНИ', MEDIUM: 'ВАЖНИ', LOW: 'ИНФОРМАТИВНИ' };
                  return (
                    <div key={sev} className={`border p-4 flex items-center gap-3 ${colors[sev]}`}>
                      <SeverityDot severity={sev} />
                      <div>
                        <p className="font-label-caps text-label-caps text-on-surface-variant">{labels[sev]}</p>
                        <p className="font-headline text-headline-sm text-on-surface">{count}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {missingLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-surface-container-low border border-outline-variant/10 animate-pulse" />)}
              </div>
            ) : (missing as any[]).length === 0 ? (
              <div className="py-16 text-center border border-outline-variant/10 bg-surface-container-low">
                <span className="material-symbols-outlined text-4xl text-primary block mb-3">check_circle</span>
                <p className="font-label-caps text-label-caps text-primary">ВСИЧКИ ДОКУМЕНТИ СА НАЛИЦЕ</p>
                <p className="font-body-sm text-body-sm text-on-surface-variant/60 mt-2">Няма липсващи документи</p>
              </div>
            ) : (
              <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header w-8"></th>
                      <th className="table-header">ТИП</th>
                      <th className="table-header">КОНТРАГЕНТ</th>
                      <th className="table-header">ПРОЕКТ</th>
                      <th className="table-header">ОПИСАНИЕ</th>
                      <th className="table-header">СТАТУС</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(missing as any[]).map((m: any) => (
                      <tr key={m.id} className="hover:bg-surface-container transition-colors">
                        <td className="table-cell">
                          <SeverityDot severity={m.severity || 'LOW'} />
                        </td>
                        <td className="table-cell">
                          <span className="font-label-caps text-[9px] text-on-surface-variant border border-outline-variant/20 px-2 py-0.5">
                            {MISSING_TYPE_LABELS[m.type] || m.type}
                          </span>
                        </td>
                        <td className="table-cell font-medium text-on-surface">
                          {m.counterparty?.name || '—'}
                        </td>
                        <td className="table-cell text-on-surface-variant">
                          {m.project ? (
                            <a href={`/projects/${m.project.id}`} className="hover:text-primary transition-colors">
                              {m.project.code}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="table-cell text-on-surface-variant/70 truncate max-w-[280px]">
                          {m.description || m.notes || '—'}
                        </td>
                        <td className="table-cell">
                          <span className={`font-label-caps text-[9px] px-2 py-0.5 border ${
                            m.status === 'OPEN'
                              ? 'border-warning/30 bg-warning/10 text-warning'
                              : 'border-outline-variant/20 text-on-surface-variant'
                          }`}>{m.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: COVERAGE ──────────────────────────────────────────────────── */}
        {tab === 'coverage' && (
          <div className="space-y-4">
            {(coverage as any[]).length === 0 ? (
              <div className="py-16 text-center border border-outline-variant/10 bg-surface-container-low">
                <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 block mb-3">fact_check</span>
                <p className="font-body-sm text-body-sm text-on-surface-variant/60">Няма coverage данни</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {(coverage as any[]).map((c: any) => {
                  const pct = c.totalItems > 0 ? Math.round((c.processedItems / c.totalItems) * 100) : 0;
                  const color = pct >= 80 ? 'bg-primary-container' : pct >= 50 ? 'bg-warning' : 'bg-error';
                  return (
                    <div key={c.id} className="border border-outline-variant/10 bg-surface-container-low p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-label-caps text-label-caps text-on-surface">{c.source}</p>
                          <p className="font-label-caps text-[9px] text-on-surface-variant/60">{c.year}</p>
                        </div>
                        <span className={`font-headline text-headline-sm ${pct >= 80 ? 'text-primary' : pct >= 50 ? 'text-warning' : 'text-error'}`}>
                          {pct}%
                        </span>
                      </div>
                      <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex justify-between mt-2">
                        <span className="font-label-caps text-[9px] text-on-surface-variant/60">{c.processedItems} обработени</span>
                        <span className="font-label-caps text-[9px] text-on-surface-variant/60">{c.totalItems} общо</span>
                      </div>
                      {c.notes && <p className="font-body-sm text-body-sm text-on-surface-variant/50 mt-2 text-[11px]">{c.notes}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
