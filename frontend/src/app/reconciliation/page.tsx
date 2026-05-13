'use client';
import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
  DOCUMENT_TO_SOURCE:   { bg: 'Документ → Източник', en: 'Document → Source', icon: 'link', color: 'text-secondary' },
  EMAIL_TO_DOCUMENT:    { bg: 'Имейл → Документ', en: 'Email → Document', icon: 'mail', color: 'text-on-surface-variant' },
  PARTIAL_MATCH:        { bg: 'Частично съвпадение', en: 'Partial Match', icon: 'match_case', color: 'text-warning' },
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
  const qc = useQueryClient();
  const [tab, setTab] = useState<'links' | 'missing' | 'coverage' | 'bank'>('links');
  const [linkTypeFilter, setLinkTypeFilter] = useState('');
  const [bankYear, setBankYear] = useState(new Date().getFullYear().toString());
  const [bankStatus, setBankStatus] = useState('');
  const [bankPage, setBankPage] = useState(1);
  const [importResult, setImportResult] = useState<{ created: number; skipped: number; errors: number; currency?: string } | null>(null);
  const [matchResult, setMatchResult] = useState<{ matched: number; partial: number; unmatched: number; totalProcessed: number } | null>(null);
  const [migJobId, setMigJobId] = useState<string | null>(null);
  const [migJob, setMigJob] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll migration job status
  useEffect(() => {
    if (!migJobId || migJob?.status === 'done' || migJob?.status === 'error') return;
    const iv = setInterval(async () => {
      try {
        const { data } = await api.get(`/backfill/job/${migJobId}`);
        setMigJob(data);
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(iv);
          qc.invalidateQueries({ queryKey: ['reconciliation-links'] });
          qc.invalidateQueries({ queryKey: ['recon-stats'] });
        }
      } catch {}
    }, 2000);
    return () => clearInterval(iv);
  }, [migJobId, migJob?.status, qc]);

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

  const { data: paymentsData, isLoading: paymentsLoading } = useQuery({
    queryKey: ['payments', bankYear, bankStatus, bankPage],
    queryFn: () => api.get(`/payments?year=${bankYear}&status=${bankStatus}&page=${bankPage}&limit=50`).then(r => r.data),
    enabled: tab === 'bank',
  });

  const importCsv = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/payments/import-csv', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(r => r.data);
    },
    onSuccess: (data) => {
      setImportResult(data);
      qc.invalidateQueries({ queryKey: ['payments'] });
    },
  });

  const autoMatch = useMutation({
    mutationFn: () => api.post(`/reconciliation/auto-match?year=${bankYear}`).then(r => r.data),
    onSuccess: (data) => {
      setMatchResult(data);
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['recon-stats'] });
    },
  });

  const migratePurchases = useMutation({
    mutationFn: () => api.post('/backfill/purchases-to-bizdocs', { includePurchases: true, includeInvoices: true }).then(r => r.data),
    onSuccess: (data) => {
      setMigJobId(data.jobId);
      setMigJob({ status: 'running', log: [] });
    },
  });

  const { data: reconStats } = useQuery({
    queryKey: ['recon-stats', bankYear],
    queryFn: () => api.get(`/reconciliation/stats?year=${bankYear}`).then(r => r.data),
    enabled: tab === 'bank',
    refetchInterval: migJob?.status === 'running' ? 5000 : false,
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
        <div className="px-8 flex gap-0 border-t border-outline-variant/5 overflow-x-auto">
          {[
            { key: 'links', icon: 'account_tree', label: 'Документни вериги', count: (links as any[]).length },
            { key: 'missing', icon: 'report_problem', label: 'Липсващи документи', count: (missing as any[]).length },
            { key: 'coverage', icon: 'fact_check', label: 'Покритие', count: (coverage as any[]).length },
            { key: 'bank', icon: 'account_balance', label: 'Банка', count: paymentsData?.total ?? 0 },
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

        {/* ── TAB: BANK ──────────────────────────────────────────────────────── */}
        {tab === 'bank' && (
          <div className="space-y-4">

            {/* reconciliation stats */}
            {reconStats && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'ОБЩО', value: reconStats.totalPayments, color: 'text-on-surface' },
                  { label: 'MATCHED', value: reconStats.matchedPayments, color: 'text-primary' },
                  { label: 'PARTIAL', value: reconStats.partialPayments, color: 'text-warning' },
                  { label: 'MATCH RATE', value: `${reconStats.matchRate}%`, color: reconStats.matchRate >= 50 ? 'text-primary' : reconStats.matchRate >= 20 ? 'text-warning' : 'text-error' },
                ].map(s => (
                  <div key={s.label} className="border border-outline-variant/10 bg-surface-container-low p-4">
                    <p className="font-label-caps text-[9px] text-on-surface-variant/60">{s.label}</p>
                    <p className={`font-headline text-headline-sm mt-1 ${s.color}`}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* toolbar */}
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={bankYear}
                onChange={e => { setBankYear(e.target.value); setBankPage(1); }}
                className="border border-outline-variant/30 bg-surface-container-low px-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary"
              >
                {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <select
                value={bankStatus}
                onChange={e => { setBankStatus(e.target.value); setBankPage(1); }}
                className="border border-outline-variant/30 bg-surface-container-low px-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary"
              >
                <option value="">Всички статуси</option>
                <option value="UNMATCHED">UNMATCHED</option>
                <option value="PARTIAL">PARTIAL</option>
                <option value="MATCHED">MATCHED</option>
              </select>
              <div className="flex-1" />
              <input type="file" accept=".csv" ref={fileInputRef} className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) importCsv.mutate(f); e.target.value = ''; }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={importCsv.isPending}
                className="flex items-center gap-2 px-4 py-2 border border-outline-variant/30 bg-surface-container-low font-label-caps text-label-caps text-on-surface hover:bg-surface-container disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">upload_file</span>
                {importCsv.isPending ? 'Зарежда...' : 'Импорт CSV'}
              </button>
              <button
                onClick={() => migratePurchases.mutate()}
                disabled={migratePurchases.isPending || migJob?.status === 'running'}
                title="Мигрира Purchase и Invoice записи в BizDocument модела за reconciliation"
                className="flex items-center gap-2 px-4 py-2 border border-outline-variant/30 bg-surface-container-low font-label-caps text-label-caps text-on-surface hover:bg-surface-container disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">sync_alt</span>
                {migJob?.status === 'running' ? 'Мигрира...' : 'Покупки → BizDocs'}
              </button>
              <button
                onClick={() => autoMatch.mutate()}
                disabled={autoMatch.isPending}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary font-label-caps text-label-caps hover:bg-primary/90 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">auto_fix_high</span>
                {autoMatch.isPending ? 'Обработва...' : 'Авто-Match'}
              </button>
            </div>

            {/* result banners */}
            {importResult && (
              <div className="flex items-center gap-4 border border-primary/20 bg-primary/5 px-4 py-3">
                <span className="material-symbols-outlined text-[18px] text-primary">check_circle</span>
                <span className="font-label-caps text-label-caps text-on-surface">
                  Импорт завършен: <span className="text-primary">{importResult.created} нови</span>, {importResult.skipped} пропуснати
                  {importResult.currency && ` · ${importResult.currency}`}
                </span>
                <button onClick={() => setImportResult(null)} className="ml-auto text-on-surface-variant/40 hover:text-on-surface">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            )}
            {matchResult && (
              <div className="flex items-center gap-4 border border-primary/20 bg-primary/5 px-4 py-3">
                <span className="material-symbols-outlined text-[18px] text-primary">auto_fix_high</span>
                <span className="font-label-caps text-label-caps text-on-surface">
                  Auto-match: <span className="text-primary">{matchResult.matched} съвпадения</span>, {matchResult.partial} частични, {matchResult.unmatched} без съвпадение
                  {' '}· {matchResult.totalProcessed} обработени
                </span>
                <button onClick={() => setMatchResult(null)} className="ml-auto text-on-surface-variant/40 hover:text-on-surface">
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              </div>
            )}

            {/* migration job status */}
            {migJob && (
              <div className={`border px-4 py-3 ${migJob.status === 'done' ? 'border-primary/20 bg-primary/5' : migJob.status === 'error' ? 'border-error/20 bg-error/5' : 'border-outline-variant/20 bg-surface-container-low'}`}>
                <div className="flex items-center gap-3 mb-2">
                  <span className={`material-symbols-outlined text-[18px] ${migJob.status === 'running' ? 'animate-spin text-primary' : migJob.status === 'done' ? 'text-primary' : 'text-error'}`}>
                    {migJob.status === 'running' ? 'sync' : migJob.status === 'done' ? 'check_circle' : 'error'}
                  </span>
                  <span className="font-label-caps text-label-caps text-on-surface">
                    {migJob.status === 'running' ? 'Миграция в процес...' :
                     migJob.status === 'done' ? `Готово! Покупки: ${migJob.result?.purchasesMigrated ?? 0}, Фактури: ${migJob.result?.invoicesMigrated ?? 0}, Нови CP: ${migJob.result?.counterpartiesCreated ?? 0}` :
                     `Грешка: ${migJob.error}`}
                  </span>
                  {migJob.status !== 'running' && (
                    <button onClick={() => { setMigJob(null); setMigJobId(null); }} className="ml-auto text-on-surface-variant/40 hover:text-on-surface">
                      <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                  )}
                </div>
                {migJob.log && migJob.log.length > 0 && (
                  <div className="bg-surface-container border border-outline-variant/10 p-2 max-h-32 overflow-y-auto font-mono text-[10px] text-on-surface-variant/70">
                    {migJob.log.slice(-15).map((l: string, i: number) => <div key={i}>{l}</div>)}
                  </div>
                )}
              </div>
            )}

            {/* payments table */}
            {paymentsLoading ? (
              <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-surface-container-low border border-outline-variant/10 animate-pulse" />)}</div>
            ) : (paymentsData?.data ?? []).length === 0 ? (
              <div className="py-16 text-center border border-outline-variant/10 bg-surface-container-low">
                <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 block mb-3">account_balance</span>
                <p className="font-body-sm text-body-sm text-on-surface-variant/60">Няма банкови транзакции за {bankYear}</p>
              </div>
            ) : (
              <>
                <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header">ДАТА</th>
                        <th className="table-header">КОНТРАГЕНТ</th>
                        <th className="table-header">ОСНОВАНИЕ</th>
                        <th className="table-header text-right">ДЕБИТ</th>
                        <th className="table-header text-right">КРЕДИТ</th>
                        <th className="table-header">ВАЛ.</th>
                        <th className="table-header">СТАТУС</th>
                        <th className="table-header">ДОКУМЕНТ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(paymentsData?.data ?? []).map((p: any) => {
                        const statusColors: Record<string, string> = {
                          MATCHED: 'border-primary/30 bg-primary/10 text-primary',
                          PARTIAL: 'border-warning/30 bg-warning/10 text-warning',
                          UNMATCHED: 'border-outline-variant/30 text-on-surface-variant',
                        };
                        const linkedDoc = p.reconciliationLinks?.[0]?.targetDoc;
                        return (
                          <tr key={p.id} className="hover:bg-surface-container transition-colors">
                            <td className="table-cell text-on-surface-variant/70 text-xs whitespace-nowrap">{fmtDate(p.paymentDate)}</td>
                            <td className="table-cell font-medium text-on-surface max-w-[160px] truncate">{p.counterparty?.name || '—'}</td>
                            <td className="table-cell text-on-surface-variant/70 text-xs max-w-[200px] truncate">{p.notes || '—'}</td>
                            <td className="table-cell text-right font-mono text-xs text-error">
                              {p.amount > 0 && !p.notes?.includes('credit') ? fmt(p.amount, p.currency) : '—'}
                            </td>
                            <td className="table-cell text-right font-mono text-xs text-primary">
                              {p.amount > 0 ? fmt(p.amount, p.currency) : '—'}
                            </td>
                            <td className="table-cell text-on-surface-variant/60 text-xs">{p.currency}</td>
                            <td className="table-cell">
                              <span className={`font-label-caps text-[9px] px-2 py-0.5 border ${statusColors[p.status] || 'border-outline-variant/30 text-on-surface-variant'}`}>
                                {p.status}
                              </span>
                            </td>
                            <td className="table-cell text-xs text-on-surface-variant/60">
                              {linkedDoc ? (
                                <span className="text-primary font-mono">{linkedDoc.docNumber || linkedDoc.docType}</span>
                              ) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {/* pagination */}
                {paymentsData && paymentsData.total > paymentsData.limit && (
                  <div className="flex items-center justify-between px-1">
                    <span className="font-label-caps text-label-caps text-on-surface-variant/60">
                      {(bankPage - 1) * 50 + 1}–{Math.min(bankPage * 50, paymentsData.total)} от {paymentsData.total}
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => setBankPage(p => Math.max(1, p - 1))} disabled={bankPage === 1}
                        className="px-3 py-1 border border-outline-variant/30 font-label-caps text-label-caps disabled:opacity-30 hover:bg-surface-container">
                        ‹ Назад
                      </button>
                      <button onClick={() => setBankPage(p => p + 1)} disabled={bankPage * 50 >= paymentsData.total}
                        className="px-3 py-1 border border-outline-variant/30 font-label-caps text-label-caps disabled:opacity-30 hover:bg-surface-container">
                        Напред ›
                      </button>
                    </div>
                  </div>
                )}
              </>
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
