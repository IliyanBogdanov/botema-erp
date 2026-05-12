'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Modal } from '@/components/Modal';
import { ExternalLink, AlertTriangle } from 'lucide-react';

interface Document {
  id: string;
  filename: string;
  driveUrl?: string;
  type?: string;
  status: string;
  createdAt: string;
  confidence?: number;
  suggestedAction?: string;
  riskFlags?: string[];
  alerts?: any[];
  extractedData?: Record<string, any>;
}

function getStatusTabs(t: ReturnType<typeof useT>) {
  return [
    { value: '', label: t('doc.allStatuses'), color: '#0a84ff' },
    { value: 'PENDING', label: t('doc.pending'), color: '#ff9f0a' },
    { value: 'PROCESSED', label: t('doc.reviewed'), color: '#30d158' },
    { value: 'LINKED', label: 'Свързани', color: '#bf5af2' },
  ];
}

const ACTION_LABELS: Record<string, string> = {
  CREATE_PURCHASE: 'Входяща фактура / доставка',
  CREATE_INVOICE: 'Изходяща фактура',
  CREATE_EXPENSE: 'Разход',
  ARCHIVE_ONLY: 'Само архивирай',
  REJECT: 'Отхвърли',
};

const RISK_LABELS: Record<string, string> = {
  DUPLICATE_INVOICE: 'Възможен дубликат',
  MISSING_INVOICE_NO: 'Липсва номер',
  MISSING_DATE: 'Липсва дата',
  MISSING_CURRENCY: 'Липсва валута',
  MISSING_AMOUNT: 'Липсва сума',
  MISSING_VAT: 'Липсва ДДС',
  UNKNOWN_COUNTERPARTY: 'Непознат контрагент',
  LOW_CONFIDENCE: 'Ниска увереност',
  TOTAL_MISMATCH: 'Разминаване в сумите',
};

const DOC_TYPE_LABELS: Record<string, string> = {
  INVOICE_IN: 'Входяща Фактура',
  INVOICE_OUT: 'Изходяща Фактура',
  OFFER_OUT: 'Оферта',
  DELIVERY_NOTE: 'Доставка',
  BANK_STATEMENT: 'Банково Извлечение',
  PROTOCOL: 'Протокол',
  CONTRACT: 'Договор',
  OTHER: 'Друго',
};

const DOC_TYPE_ICONS: Record<string, string> = {
  INVOICE_IN: 'receipt_long',
  INVOICE_OUT: 'edit_document',
  OFFER_OUT: 'description',
  DELIVERY_NOTE: 'local_shipping',
  BANK_STATEMENT: 'account_balance',
  PROTOCOL: 'assignment',
  CONTRACT: 'gavel',
  OTHER: 'article',
};

const LINK_TYPE_COLORS: Record<string, string> = {
  INVOICE_TO_PURCHASE: '#0a84ff',
  OFFER_TO_PROJECT: '#30d158',
  DELIVERY_TO_PURCHASE: '#ff9f0a',
  EMAIL_TO_DOCUMENT: '#bf5af2',
  DOCUMENT_TO_SOURCE: '#636366',
  PARTIAL_MATCH: '#ff6b35',
};

function LinkedDocsView() {
  const { data, isLoading } = useQuery({
    queryKey: ['biz-docs-graph'],
    queryFn: () => api.get('/biz-documents/graph').then(r => r.data),
    staleTime: 60000,
  });
  const [search, setSearch] = useState('');

  if (isLoading) return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-6">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="bg-surface-container-low rounded-xl border border-outline-variant/8 p-5 animate-pulse h-40" />
      ))}
    </div>
  );

  const chains: any[] = data?.chains || [];
  const stats: any = data?.stats || {};

  const filtered = search
    ? chains.filter(c =>
        (c.root?.counterparty?.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (c.root?.docNumber || '').toLowerCase().includes(search.toLowerCase()) ||
        (c.root?.docType || '').toLowerCase().includes(search.toLowerCase())
      )
    : chains;

  return (
    <div className="mt-6">
      {/* Stats bar */}
      <div className="flex items-center gap-6 mb-6 flex-wrap">
        <div className="flex items-center gap-2 bg-surface-container-low rounded-lg px-4 py-2.5 border border-outline-variant/8">
          <span className="material-symbols-outlined text-primary text-[18px]">account_tree</span>
          <span className="font-data-mono text-lg text-on-surface">{data?.total || 0}</span>
          <span className="font-label-caps text-[9px] text-on-surface-variant/60 tracking-[0.14em]">ВЕРИГИ</span>
        </div>
        <div className="flex items-center gap-2 bg-surface-container-low rounded-lg px-4 py-2.5 border border-outline-variant/8">
          <span className="material-symbols-outlined text-[18px]" style={{ color: LINK_TYPE_COLORS.INVOICE_TO_PURCHASE }}>receipt_long</span>
          <span className="font-data-mono text-lg text-on-surface">{stats.byType?.INVOICE_TO_PURCHASE || 0}</span>
          <span className="font-label-caps text-[9px] text-on-surface-variant/60 tracking-[0.14em]">ФАКТУРИ</span>
        </div>
        <div className="flex items-center gap-2 bg-surface-container-low rounded-lg px-4 py-2.5 border border-outline-variant/8">
          <span className="material-symbols-outlined text-[18px]" style={{ color: LINK_TYPE_COLORS.OFFER_TO_PROJECT }}>description</span>
          <span className="font-data-mono text-lg text-on-surface">{stats.byType?.OFFER_TO_PROJECT || 0}</span>
          <span className="font-label-caps text-[9px] text-on-surface-variant/60 tracking-[0.14em]">ОФЕРТИ</span>
        </div>
        <div className="ml-auto">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant/50">search</span>
            <input
              className="bg-surface-container-low rounded-lg border border-outline-variant/15 pl-9 pr-4 py-2 text-body-sm text-on-surface outline-none focus:ring-1 focus:ring-primary-container/40 w-60"
              placeholder="Търси контрагент / номер..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Chain cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.slice(0, 120).map((chain: any, i: number) => {
          const root = chain.root;
          if (!root) return null;
          const icon = DOC_TYPE_ICONS[root.docType] || 'article';
          const typeLabel = DOC_TYPE_LABELS[root.docType] || root.docType;
          return (
            <div key={root.id || i} className="bg-surface-container-low rounded-xl border border-outline-variant/8 p-5 hover:border-outline-variant/20 hover:shadow-[0_4px_20px_rgba(0,0,0,0.3)] transition-all duration-200">
              {/* Root doc */}
              <div className="flex items-start gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary-container/10 border border-primary-container/15 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-primary text-[16px]">{icon}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-label-caps text-[9px] text-primary/70 tracking-[0.14em] uppercase">{typeLabel}</span>
                    {root.docNumber && (
                      <span className="font-data-mono text-[10px] text-on-surface-variant/50">#{root.docNumber}</span>
                    )}
                  </div>
                  <p className="font-label-caps text-[12px] text-on-surface truncate mt-0.5">
                    {root.counterparty?.name || 'Unknown'}
                  </p>
                  {root.amountTotal && (
                    <p className="font-data-mono text-[11px] text-primary/80 mt-0.5">
                      {Number(root.amountTotal).toLocaleString('bg-BG', { maximumFractionDigits: 0 })} {root.currency || 'BGN'}
                    </p>
                  )}
                </div>
              </div>

              {/* Links */}
              <div className="space-y-2 border-t border-outline-variant/8 pt-3">
                {chain.links.slice(0, 3).map((link: any, j: number) => {
                  const linkColor = LINK_TYPE_COLORS[link.linkType] || '#636366';
                  const target = link.target;
                  if (!target) return null;
                  return (
                    <div key={j} className="flex items-center gap-2">
                      <div className="w-px h-4 ml-3.5 flex-shrink-0" style={{ background: `${linkColor}60` }} />
                      <div className="flex-1 flex items-center gap-2 min-w-0">
                        <span className="material-symbols-outlined text-[13px] flex-shrink-0" style={{ color: linkColor }}>
                          {DOC_TYPE_ICONS[target.docType] || 'article'}
                        </span>
                        <span className="font-label-caps text-[10px] text-on-surface-variant/70 truncate">
                          {DOC_TYPE_LABELS[target.docType] || target.docType}
                          {target.docNumber ? ` #${target.docNumber}` : ''}
                          {target.counterparty?.name ? ` · ${target.counterparty.name}` : ''}
                        </span>
                        {target.amountTotal && (
                          <span className="font-data-mono text-[10px] ml-auto flex-shrink-0" style={{ color: linkColor }}>
                            {Number(target.amountTotal).toLocaleString('bg-BG', { maximumFractionDigits: 0 })}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {chain.links.length > 3 && (
                  <div className="font-label-caps text-[9px] text-on-surface-variant/40 pl-4">
                    +{chain.links.length - 3} more links
                  </div>
                )}
              </div>

              {/* Project tag */}
              {root.project && (
                <div className="mt-3 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[12px] text-on-surface-variant/40">folder_open</span>
                  <span className="font-label-caps text-[9px] text-on-surface-variant/40 truncate">
                    {root.project.code} — {root.project.name}
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-3 text-center py-16 text-on-surface-variant">
            <span className="material-symbols-outlined text-[56px] block mb-4 opacity-30">account_tree</span>
            <p className="font-label-caps text-label-caps">Няма свързани документи</p>
          </div>
        )}
      </div>
    </div>
  );
}
function ReviewModal({ doc, onClose }: { doc: Document | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState('ARCHIVE_ONLY');
  const [fields, setFields] = useState<Record<string, any>>({});
  const [clientId, setClientId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [category, setCategory] = useState('Документи');
  const [error, setError] = useState('');

  const { data: clients = [] } = useQuery({ queryKey: ['clients-list'], queryFn: () => api.get('/clients').then(r => r.data) });
  const { data: suppliers = [] } = useQuery({ queryKey: ['suppliers-list'], queryFn: () => api.get('/suppliers').then(r => r.data) });
  const { data: projects = [] } = useQuery({ queryKey: ['projects-list'], queryFn: () => api.get('/projects').then(r => r.data) });

  useEffect(() => {
    if (!doc) return;
    setAction(doc.suggestedAction || 'ARCHIVE_ONLY');
    setFields({
      type: doc.extractedData?.type || doc.type || 'INVOICE_IN',
      invoiceNo: doc.extractedData?.invoiceNo || '',
      date: doc.extractedData?.date || new Date().toISOString().slice(0, 10),
      supplierName: doc.extractedData?.supplierName || '',
      clientName: doc.extractedData?.clientName || '',
      description: doc.extractedData?.description || doc.filename,
      amount: doc.extractedData?.amount ?? doc.extractedData?.amountNet ?? '',
      vatAmount: doc.extractedData?.vatAmount ?? '',
      amountTotal: doc.extractedData?.amountTotal ?? doc.extractedData?.amount ?? '',
      currency: doc.extractedData?.currency || 'BGN',
      items: doc.extractedData?.items || [],
    });
    setClientId('');
    setSupplierId('');
    setProjectId('');
    setError('');
  }, [doc]);

  const review = useMutation({
    mutationFn: () => api.post(`/documents/${doc?.id}/review`, {
      action,
      data: fields,
      clientId: clientId || undefined,
      supplierId: supplierId || undefined,
      projectId: projectId || undefined,
      category,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['pending-docs'] });
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-sidebar'] });
      qc.invalidateQueries({ queryKey: ['dashboard-alerts'] });
      onClose();
    },
    onError: (err: any) => setError(err.response?.data?.error || 'Грешка при вкарване на документа'),
  });

  if (!doc) return null;

  const setField = (key: string, value: string) => setFields(f => ({ ...f, [key]: value }));
  const risks = Array.isArray(doc.riskFlags) ? doc.riskFlags : [];

  return (
    <Modal open={Boolean(doc)} onClose={onClose} title="Преглед на документ" size="xl">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white">{doc.filename}</div>
            <div className="text-xs text-[#71717a] mt-1">Увереност: {Math.round(Number(doc.confidence || 0) * 100)}%</div>
          </div>
          <div className="flex gap-2">
            {doc.driveUrl && (
              <a href={doc.driveUrl} target="_blank" className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1">
                <ExternalLink size={12} /> Drive
              </a>
            )}
          </div>
        </div>

        {/* Inline PDF viewer */}
        {doc.driveUrl && (
          <div className="rounded-xl overflow-hidden border border-outline-variant/30">
            <iframe
              src={`https://drive.google.com/file/d/${doc.driveUrl.match(/\/d\/([\w-]+)/)?.[1]}/preview`}
              className="w-full"
              style={{ height: 340 }}
              title={doc.filename}
              allow="autoplay"
            />
          </div>
        )}

        {risks.length > 0 && (
          <div className="border border-error/20 bg-error/5 p-4">
            <div className="font-label-caps text-label-caps text-error mb-2 flex items-center gap-2">
              <AlertTriangle size={14} className="flex-shrink-0" /> Провери преди запис
            </div>
            <div className="flex gap-2 flex-wrap">
              {risks.map(r => (
                <span key={r} className="text-[10px] px-2 py-1 bg-error/10 text-error border border-error/20">
                  {RISK_LABELS[r] || r}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Какво да направя?</label>
          <select className="input" value={action} onChange={e => setAction(e.target.value)}>
            {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        {action !== 'REJECT' && action !== 'ARCHIVE_ONLY' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Номер</label>
                <input className="input" value={fields.invoiceNo || ''} onChange={e => setField('invoiceNo', e.target.value)} />
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Дата</label>
                <input type="date" className="input" value={fields.date || ''} onChange={e => setField('date', e.target.value)} />
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Валута</label>
                <select className="input" value={fields.currency || 'BGN'} onChange={e => setField('currency', e.target.value)}>
                  <option value="BGN">BGN</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Общо</label>
                <input type="number" step="0.01" className="input" value={fields.amountTotal || ''} onChange={e => setField('amountTotal', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Нето</label>
                <input type="number" step="0.01" className="input" value={fields.amount || ''} onChange={e => setField('amount', e.target.value)} />
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">ДДС</label>
                <input type="number" step="0.01" className="input" value={fields.vatAmount || ''} onChange={e => setField('vatAmount', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Описание</label>
              <textarea className="input" rows={2} value={fields.description || ''} onChange={e => setField('description', e.target.value)} />
            </div>

            {action === 'CREATE_PURCHASE' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Доставчик</label>
                  <select className="input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                    <option value="">Автоматично / нов: {fields.supplierName || 'Непознат'}</option>
                    {(suppliers as any[]).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Проект</label>
                  <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
                    <option value="">Без проект</option>
                    {(projects as any[]).map(p => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                  </select>
                </div>
              </div>
            )}

            {action === 'CREATE_INVOICE' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Клиент</label>
                  <select className="input" value={clientId} onChange={e => setClientId(e.target.value)}>
                    <option value="">Автоматично / нов: {fields.clientName || 'Непознат'}</option>
                    {(clients as any[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Проект</label>
                  <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
                    <option value="">Без проект</option>
                    {(projects as any[]).map(p => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                  </select>
                </div>
              </div>
            )}

            {action === 'CREATE_EXPENSE' && (
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">Категория разход</label>
                <input className="input" value={category} onChange={e => setCategory(e.target.value)} />
              </div>
            )}
          </>
        )}

        {error && <div className="text-error font-body-sm">{error}</div>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Отказ</button>
          <button onClick={() => review.mutate()} disabled={review.isPending} className="btn-primary disabled:opacity-50">
            {review.isPending ? 'Запис...' : action === 'REJECT' ? 'Отхвърли' : 'Вкарай'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function DocumentsPage() {
  const [activeStatus, setActiveStatus] = useState('PENDING');
  const [selected, setSelected] = useState<Document | null>(null);
  const [reviewDoc, setReviewDoc] = useState<Document | null>(null);
  const [reparseJobId, setReparseJobId] = useState<string | null>(null);
  const [reparseStatus, setReparseStatus] = useState<any>(null);
  const [gmailScanStatus, setGmailScanStatus] = useState<any>(null);
  const [docSearch, setDocSearch] = useState('');
  const t = useT();
  const statusTabs = getStatusTabs(t);
  const qc = useQueryClient();

  const { data = {}, isLoading } = useQuery({
    queryKey: ['documents', activeStatus],
    queryFn: () => api.get(`/documents?status=${activeStatus}`).then(r => r.data),
    staleTime: 15000,
    refetchInterval: activeStatus === 'PENDING' ? 30000 : undefined,
  });

  const docs: Document[] = Array.isArray(data) ? data : (data as any).data || [];

  const filteredDocs = docSearch
    ? docs.filter(d =>
        (d.extractedData?.supplierName || '').toLowerCase().includes(docSearch.toLowerCase()) ||
        (d.extractedData?.clientName || '').toLowerCase().includes(docSearch.toLowerCase()) ||
        (d.extractedData?.invoiceNo || '').toLowerCase().includes(docSearch.toLowerCase()) ||
        (d.filename || '').toLowerCase().includes(docSearch.toLowerCase())
      )
    : docs;

  const startReparse = async () => {
    const resp = await api.post('/documents/reparse-all').then(r => r.data);
    setReparseJobId(resp.jobId);
    setReparseStatus({ status: 'running', done: 0, total: 0 });
    const poll = setInterval(async () => {
      try {
        const job = await api.get(`/documents/reparse-job/${resp.jobId}`).then(r => r.data);
        setReparseStatus(job);
        if (job.status === 'done' || job.status === 'error') {
          clearInterval(poll);
          qc.invalidateQueries({ queryKey: ['documents'] });
        }
      } catch { clearInterval(poll); }
    }, 3000);
  };

  const startGmailScan = async () => {
    setGmailScanStatus({ status: 'running', done: 0, total: 0, documents: 0, bankTx: 0 });
    try {
      const resp = await api.post('/documents/gmail-scan').then(r => r.data);
      const poll = setInterval(async () => {
        try {
          const job = await api.get(`/documents/gmail-scan-job/${resp.jobId}`).then(r => r.data);
          setGmailScanStatus(job);
          if (job.status === 'done' || job.status === 'error') {
            clearInterval(poll);
            qc.invalidateQueries({ queryKey: ['documents'] });
          }
        } catch { clearInterval(poll); }
      }, 4000);
    } catch (e: any) {
      setGmailScanStatus({ status: 'error', error: e.message });
    }
  };

  return (
    <div className="p-container-padding">
      <div className="max-w-7xl mx-auto">

        {/* Page Title */}
        <div className="flex justify-between items-end mb-8">
          <div>
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-2">{t('doc.label')}</p>
            <h2 className="font-headline text-headline-lg text-on-background">{t('doc.title')}</h2>
            <p className="text-on-surface-variant font-body-md mt-2">
              {t('doc.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(reparseStatus || gmailScanStatus) && (
              <span className="font-label-caps text-label-caps text-on-surface-variant text-xs max-w-[220px]">
                {gmailScanStatus?.status === 'running'
                  ? `Gmail: ${gmailScanStatus.done}/${gmailScanStatus.total} имейла…`
                  : gmailScanStatus?.status === 'done'
                  ? `✓ Gmail: ${gmailScanStatus.documents} документа, ${gmailScanStatus.bankTx} транзакции`
                  : reparseStatus?.status === 'running'
                  ? `AI парсинг: ${reparseStatus.done}/${reparseStatus.total}…`
                  : reparseStatus?.status === 'done'
                  ? `✓ ${reparseStatus.done} документа обработени`
                  : null}
              </span>
            )}
            {activeStatus === 'PENDING' && (
              <button
                onClick={startReparse}
                disabled={reparseStatus?.status === 'running'}
                className="px-4 py-2.5 border border-primary/40 text-primary font-label-caps text-label-caps hover:bg-primary/10 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <span className={`material-symbols-outlined text-[18px] ${reparseStatus?.status === 'running' ? 'animate-spin' : ''}`}>auto_fix_high</span>
                AI анализ Drive
              </button>
            )}
            <button
              onClick={startGmailScan}
              disabled={gmailScanStatus?.status === 'running'}
              className="px-4 py-2.5 border border-secondary/40 text-secondary font-label-caps text-label-caps hover:bg-secondary/10 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <span className={`material-symbols-outlined text-[18px] ${gmailScanStatus?.status === 'running' ? 'animate-spin' : ''}`}>mark_email_unread</span>
              Сканирай Gmail
            </button>
            <button className="px-6 py-3 border border-outline-variant font-label-caps text-label-caps hover:bg-surface-container-high transition-colors flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">upload_file</span>
              {t('doc.uploadBatch')}
            </button>
          </div>
        </div>

        {/* Status Tabs */}
        <div className="flex gap-2 mb-8">
          {statusTabs.map(tab => (
            <button
              key={tab.value}
              onClick={() => { setActiveStatus(tab.value); setSelected(null); }}
              className={`px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                activeStatus === tab.value
                  ? 'bg-primary-container/20 text-primary-container border border-primary-container/30'
                  : 'bg-surface-container-high text-on-surface-variant border border-transparent hover:border-outline-variant'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Split Panel — hidden when LINKED tab is active */}
        {activeStatus === 'LINKED' ? (
          <LinkedDocsView />
        ) : (
        <div className="grid grid-cols-12 gap-8" style={{ height: 'calc(100vh - 340px)', minHeight: '400px' }}>

          {/* Left: Document List */}
          <div className="col-span-4 flex flex-col bg-surface-container-low border border-outline-variant overflow-hidden">
            <div className="p-4 border-b border-outline-variant flex justify-between items-center bg-surface-container flex-shrink-0">
              <span className="font-label-caps text-label-caps">{t('doc.recentUploads')}</span>
              <span className="font-data-mono text-data-mono text-primary">
                {isLoading ? '...' : `${filteredDocs.length} ${activeStatus === 'PENDING' ? t('doc.pending') : t('doc.records')}`}
              </span>
            </div>
            <div className="px-3 py-2 border-b border-outline-variant/5 bg-surface-container flex-shrink-0">
              <div className="relative">
                <span className="material-symbols-outlined text-[14px] text-on-surface-variant/50 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">search</span>
                <input
                  className="w-full bg-surface-container-high border border-outline-variant/20 pl-8 pr-3 py-1.5 font-body-sm text-body-sm text-on-surface focus:ring-1 focus:ring-primary-container focus:outline-none"
                  placeholder="Търси по доставчик, фактура..."
                  value={docSearch}
                  onChange={e => setDocSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <div key={i} className="p-5 border-b border-outline-variant/5 animate-pulse">
                    <div className="h-3 bg-surface-container-high rounded mb-2 w-3/4" />
                    <div className="h-3 bg-surface-container-high rounded w-full mb-2" />
                    <div className="h-3 bg-surface-container rounded w-1/2" />
                  </div>
                ))
              ) : filteredDocs.length === 0 ? (
                <div className="p-10 text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-[48px] block mb-3 text-outline">description</span>
                  <p className="font-body-sm">{t('doc.noDocuments')}</p>
                </div>
              ) : (
                filteredDocs.map(doc => {
                  const confidence = Math.round(Number(doc.confidence || 0) * 100);
                  const isActive = selected?.id === doc.id;
                  return (
                    <div
                      key={doc.id}
                      onClick={() => setSelected(doc)}
                      className={`p-5 border-b border-outline-variant/5 cursor-pointer relative transition-colors ${
                        isActive ? 'bg-surface-container-high' : 'hover:bg-surface-container-high/50'
                      }`}
                    >
                      {isActive && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary" />}
                      <div className="flex justify-between mb-2">
                        <span className="font-label-caps text-label-caps truncate max-w-[65%] text-on-surface-variant">
                          {doc.extractedData?.invoiceNo
                            ? `Invoice #${doc.extractedData.invoiceNo}`
                            : doc.filename.replace(/\.[^.]+$/, '').slice(0, 24)}
                        </span>
                        {confidence > 0 && (
                          <span className={`px-2 py-0.5 font-data-mono text-xs ${
                            confidence >= 80 ? 'bg-primary-container/20 text-primary' :
                            confidence >= 60 ? 'bg-secondary-container/20 text-secondary' :
                            'bg-error-container/20 text-error'
                          }`}>
                            {confidence}% Match
                          </span>
                        )}
                      </div>
                      <h4 className="font-body-md font-medium text-on-surface mb-1 truncate">
                        {doc.extractedData?.supplierName || doc.extractedData?.clientName || 'Unknown'}
                      </h4>
                      <div className="flex justify-between items-center">
                        <p className="font-data-mono text-xs text-on-surface-variant">{fmtDate(doc.createdAt)}</p>
                        {(doc.extractedData?.amountTotal || doc.extractedData?.amount) && (
                          <p className="font-data-mono text-xs font-bold text-on-background">
                            {Number(doc.extractedData.amountTotal || doc.extractedData.amount)
                              .toLocaleString('bg-BG', { minimumFractionDigits: 2 })} {doc.extractedData.currency || 'BGN'}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Document Detail */}
          <div className="col-span-8 flex flex-col gap-4 overflow-hidden">
            {!selected ? (
              <div className="flex-1 bg-surface-container-lowest border border-outline-variant flex items-center justify-center">
                <div className="text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-[64px] block mb-4 text-outline">article</span>
                  <p className="font-label-caps text-label-caps">{t('doc.noSelected')}</p>
                </div>
              </div>
            ) : (
              <>
                {/* Detail Header */}
                <div className="bg-surface-container-low border border-outline-variant flex-shrink-0">
                  <div className="p-4 flex items-center justify-between border-b border-outline-variant/10">
                    <div className="min-w-0">
                      <div className="font-body-md font-semibold text-on-surface truncate">{selected.filename}</div>
                      <div className="font-data-mono text-xs text-on-surface-variant mt-0.5">
                        {fmtDate(selected.createdAt)} · {Math.round(Number(selected.confidence || 0) * 100)}% {t('doc.confidence').toLowerCase()}
                      </div>
                    </div>
                    {selected.driveUrl && (
                      <a
                        href={selected.driveUrl}
                        target="_blank"
                        className="p-2 border border-outline-variant hover:bg-surface-container-high transition-colors flex-shrink-0"
                      >
                        <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                      </a>
                    )}
                  </div>
                </div>

                {/* Extracted Data */}
                <div className="flex-1 bg-surface-container-low border border-outline-variant overflow-y-auto">
                  <div className="p-gutter">
                    <div className="flex justify-between items-start mb-6">
                      <div>
                        <h3 className="font-headline text-headline-md mb-1 text-on-surface">{t('doc.extractedData')}</h3>
                        <p className="font-body-sm text-on-surface-variant">Verify AI-suggested fields before confirming to ERP.</p>
                      </div>
                    </div>

                    {/* Risk flags */}
                    {Array.isArray(selected.riskFlags) && selected.riskFlags.length > 0 && (
                      <div className="mb-6 border border-error/20 bg-error/5 p-4">
                        <div className="font-label-caps text-label-caps text-error mb-2 flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px]">warning</span>
                          {t('doc.riskFlags')}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {(selected.riskFlags as string[]).map(r => (
                            <span key={r} className="text-[10px] px-2 py-1 bg-error/10 text-error border border-error/20">
                              {RISK_LABELS[r] || r}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-6 mb-8">
                      {[
                        { label: 'Vendor Name', value: selected.extractedData?.supplierName || selected.extractedData?.clientName },
                        { label: 'Invoice No', value: selected.extractedData?.invoiceNo },
                        { label: 'Date', value: selected.extractedData?.date },
                        { label: 'Total Amount', value: selected.extractedData?.amountTotal != null ? `${Number(selected.extractedData.amountTotal).toLocaleString('bg-BG', {minimumFractionDigits: 2})} ${selected.extractedData.currency || 'BGN'}` : undefined },
                        { label: 'Net Amount', value: selected.extractedData?.amount != null ? `${Number(selected.extractedData.amount).toLocaleString('bg-BG', {minimumFractionDigits: 2})} ${selected.extractedData.currency || 'BGN'}` : undefined },
                        { label: 'VAT', value: selected.extractedData?.vatAmount != null ? `${Number(selected.extractedData.vatAmount).toLocaleString('bg-BG', {minimumFractionDigits: 2})} ${selected.extractedData.currency || 'BGN'}` : undefined },
                      ].map(f => (
                        <div key={f.label}>
                          <label className="font-label-caps text-label-caps block mb-2 text-on-surface-variant">{f.label}</label>
                          <div className="w-full bg-surface-dim border border-outline-variant/30 text-body-sm px-3 py-2 text-on-background font-data-mono text-data-mono">
                            {f.value || <span className="text-on-surface-variant/30">—</span>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Suggested action */}
                    <div className="p-4 bg-primary/5 border border-primary/20 mb-6">
                      <div className="font-label-caps text-label-caps text-primary mb-1">{t('doc.suggestedAction')}</div>
                      <div className="font-body-md text-on-surface">
                        {ACTION_LABELS[selected.suggestedAction || 'ARCHIVE_ONLY']}
                      </div>
                    </div>

                    {/* Action buttons */}
                    {activeStatus === 'PENDING' && (
                      <div className="flex gap-4 border-t border-outline-variant pt-6">
                        <button
                          onClick={() => setReviewDoc(selected)}
                          className="bg-primary-container text-on-primary-container px-gutter py-3 font-label-caps text-label-caps font-bold hover:opacity-90 flex items-center gap-2 transition-opacity"
                        >
                          <span className="material-symbols-outlined text-lg">check_circle</span>
                          {t('doc.confirmData')}
                        </button>
                        <button
                          onClick={() => setSelected(null)}
                          className="border border-outline-variant px-gutter py-3 font-label-caps text-label-caps hover:bg-surface-container-high transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
        )} {/* end LINKED conditional */}
      </div>

      <ReviewModal doc={reviewDoc} onClose={() => { setReviewDoc(null); setSelected(null); }} />
    </div>
  );
}
