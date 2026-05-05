'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate } from '@/lib/api';
import { Modal } from '@/components/Modal';
import { CheckCircle, XCircle, FileText, Clock, AlertTriangle, ExternalLink } from 'lucide-react';

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

const STATUS_TABS = [
  { value: 'PENDING', label: 'Чакащи', color: '#ff9f0a' },
  { value: 'PROCESSED', label: 'Архивирани', color: '#30d158' },
  { value: 'LINKED', label: 'Вкарани', color: '#0a84ff' },
  { value: 'REJECTED', label: 'Отхвърлени', color: '#ff453a' },
];

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
          {doc.driveUrl && (
            <a href={doc.driveUrl} target="_blank" className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1">
              <ExternalLink size={12} /> PDF
            </a>
          )}
        </div>

        {risks.length > 0 && (
          <div className="rounded-xl border border-[rgba(255,159,10,0.25)] bg-[rgba(255,159,10,0.08)] p-3">
            <div className="text-xs font-bold text-[#ff9f0a] mb-2 flex items-center gap-2">
              <AlertTriangle size={14} /> Провери преди запис
            </div>
            <div className="flex gap-2 flex-wrap">
              {risks.map(r => (
                <span key={r} className="text-xs px-2 py-1 rounded-md bg-[rgba(255,159,10,0.12)] text-[#ffd60a]">
                  {RISK_LABELS[r] || r}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Какво да направя?</label>
          <select className="input" value={action} onChange={e => setAction(e.target.value)}>
            {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        {action !== 'REJECT' && action !== 'ARCHIVE_ONLY' && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Номер</label>
                <input className="input" value={fields.invoiceNo || ''} onChange={e => setField('invoiceNo', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Дата</label>
                <input type="date" className="input" value={fields.date || ''} onChange={e => setField('date', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Валута</label>
                <select className="input" value={fields.currency || 'BGN'} onChange={e => setField('currency', e.target.value)}>
                  <option value="BGN">BGN</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Общо</label>
                <input type="number" step="0.01" className="input" value={fields.amountTotal || ''} onChange={e => setField('amountTotal', e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Нето</label>
                <input type="number" step="0.01" className="input" value={fields.amount || ''} onChange={e => setField('amount', e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">ДДС</label>
                <input type="number" step="0.01" className="input" value={fields.vatAmount || ''} onChange={e => setField('vatAmount', e.target.value)} />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Описание</label>
              <textarea className="input" rows={2} value={fields.description || ''} onChange={e => setField('description', e.target.value)} />
            </div>

            {action === 'CREATE_PURCHASE' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Доставчик</label>
                  <select className="input" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                    <option value="">Автоматично / нов: {fields.supplierName || 'Непознат'}</option>
                    {(suppliers as any[]).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Проект</label>
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
                  <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Клиент</label>
                  <select className="input" value={clientId} onChange={e => setClientId(e.target.value)}>
                    <option value="">Автоматично / нов: {fields.clientName || 'Непознат'}</option>
                    {(clients as any[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Проект</label>
                  <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
                    <option value="">Без проект</option>
                    {(projects as any[]).map(p => <option key={p.id} value={p.id}>{p.code} - {p.name}</option>)}
                  </select>
                </div>
              </div>
            )}

            {action === 'CREATE_EXPENSE' && (
              <div>
                <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">Категория разход</label>
                <input className="input" value={category} onChange={e => setCategory(e.target.value)} />
              </div>
            )}
          </>
        )}

        {error && <div className="text-sm text-[#ff453a]">{error}</div>}

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

  const { data = {}, isLoading } = useQuery({
    queryKey: ['documents', activeStatus],
    queryFn: () => api.get(`/documents?status=${activeStatus}`).then(r => r.data),
    staleTime: 15000,
    refetchInterval: activeStatus === 'PENDING' ? 30000 : undefined,
  });

  const docs: Document[] = Array.isArray(data) ? data : (data as any).data || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Документи</h1>
        <p className="text-[#71717a] text-sm mt-0.5">Входящи документи от Gmail с ръчно потвърждение</p>
      </div>

      <div className="flex gap-1 bg-[#1d1d1f] p-1 rounded-xl mb-6 w-fit">
        {STATUS_TABS.map(tab => (
          <button key={tab.value} onClick={() => setActiveStatus(tab.value)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              activeStatus === tab.value ? 'bg-[#27272a] text-white' : 'text-[#71717a] hover:text-white'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="card p-4 h-24 animate-pulse" />)}
        </div>
      ) : docs.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText size={40} className="mx-auto text-[#27272a] mb-3" />
          <p className="text-[#52525b] font-medium">Няма документи</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {docs.map(doc => {
            const risks = Array.isArray(doc.riskFlags) ? doc.riskFlags : [];
            return (
              <div key={doc.id} className="card p-4 hover:bg-[#18181b] transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#1d1d1f] border border-[#27272a] flex items-center justify-center flex-shrink-0">
                      <FileText size={16} className="text-[#71717a]" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-white text-sm truncate">{doc.filename}</div>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-xs text-[#71717a] flex items-center gap-1"><Clock size={11} /> {fmtDate(doc.createdAt)}</span>
                        <span className="text-xs text-[#52525b] bg-[#27272a] px-2 py-0.5 rounded-md">{ACTION_LABELS[doc.suggestedAction || 'ARCHIVE_ONLY']}</span>
                        {doc.confidence != null && <span className="text-xs text-[#71717a]">{Math.round(Number(doc.confidence) * 100)}%</span>}
                      </div>
                      <div className="mt-2 flex gap-4 flex-wrap">
                        {(doc.extractedData?.supplierName || doc.extractedData?.clientName) && (
                          <span className="text-xs text-[#a1a1aa]">{doc.extractedData.supplierName || doc.extractedData.clientName}</span>
                        )}
                        {doc.extractedData?.invoiceNo && <span className="text-xs text-[#a1a1aa] font-mono">No {doc.extractedData.invoiceNo}</span>}
                        {(doc.extractedData?.amountTotal || doc.extractedData?.amount) && (
                          <span className="text-xs font-bold text-[#30d158]">
                            {Number(doc.extractedData.amountTotal || doc.extractedData.amount).toLocaleString('bg-BG', { minimumFractionDigits: 2 })} {doc.extractedData.currency || 'BGN'}
                          </span>
                        )}
                      </div>
                      {risks.length > 0 && (
                        <div className="mt-2 flex gap-1.5 flex-wrap">
                          {risks.slice(0, 4).map(r => (
                            <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,159,10,0.12)] text-[#ff9f0a]">
                              {RISK_LABELS[r] || r}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {activeStatus === 'PENDING' ? (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => setSelected(doc)} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5">
                        <CheckCircle size={13} /> Прегледай
                      </button>
                    </div>
                  ) : (
                    <div className="flex-shrink-0">
                      {STATUS_TABS.filter(t => t.value === doc.status).map(t => (
                        <span key={t.value} className="text-xs font-bold px-2.5 py-1 rounded-full"
                          style={{ color: t.color, background: `${t.color}22` }}>
                          {t.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ReviewModal doc={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
