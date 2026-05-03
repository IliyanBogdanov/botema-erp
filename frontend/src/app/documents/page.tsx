'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate } from '@/lib/api';
import { CheckCircle, XCircle, FileText, Clock } from 'lucide-react';

interface Document {
  id: string;
  filename: string;
  type?: string;
  status: string;
  createdAt: string;
  extractedData?: {
    supplierName?: string;
    clientName?: string;
    amount?: number;
    currency?: string;
    invoiceNo?: string;
  };
}

const STATUS_TABS = [
  { value: 'PENDING', label: 'Чакащи', color: '#ff9f0a' },
  { value: 'PROCESSED', label: 'Обработени', color: '#30d158' },
  { value: 'LINKED', label: 'Свързани', color: '#0a84ff' },
  { value: 'REJECTED', label: 'Отхвърлени', color: '#ff453a' },
];

export default function DocumentsPage() {
  const [activeStatus, setActiveStatus] = useState('PENDING');
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ['documents', activeStatus],
    queryFn: () => api.get(`/documents?status=${activeStatus}`).then(r => r.data),
    staleTime: 15000,
    refetchInterval: activeStatus === 'PENDING' ? 30000 : undefined,
  });

  const docs: Document[] = Array.isArray(data) ? data : (data as any).data || [];

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/documents/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['documents'] });
      qc.invalidateQueries({ queryKey: ['pending-docs'] });
    },
  });

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Документи</h1>
        <p className="text-[#71717a] text-sm mt-0.5">Входящи документи от Gmail</p>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 bg-[#1d1d1f] p-1 rounded-xl mb-6 w-fit">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => setActiveStatus(tab.value)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              activeStatus === tab.value
                ? 'bg-[#27272a] text-white'
                : 'text-[#71717a] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Documents */}
      {isLoading ? (
        <div className="grid gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-4 animate-pulse">
              <div className="h-4 bg-[#27272a] rounded w-1/3 mb-2" />
              <div className="h-3 bg-[#27272a] rounded w-2/3" />
            </div>
          ))}
        </div>
      ) : docs.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText size={40} className="mx-auto text-[#27272a] mb-3" />
          <p className="text-[#52525b] font-medium">Няма документи</p>
          <p className="text-[#3f3f46] text-sm mt-1">
            {activeStatus === 'PENDING' ? 'Всички документи са обработени' : 'Не са намерени документи в тази категория'}
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {docs.map(doc => (
            <div key={doc.id} className="card p-4 hover:bg-[#18181b] transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex-shrink-0 mt-0.5">
                    <div className="w-9 h-9 rounded-xl bg-[#1d1d1f] border border-[#27272a] flex items-center justify-center">
                      <FileText size={16} className="text-[#71717a]" />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-white text-sm truncate">{doc.filename}</div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-[#71717a] flex items-center gap-1">
                        <Clock size={11} /> {fmtDate(doc.createdAt)}
                      </span>
                      {doc.type && (
                        <span className="text-xs text-[#52525b] bg-[#27272a] px-2 py-0.5 rounded-md">{doc.type}</span>
                      )}
                    </div>
                    {/* Extracted data */}
                    {doc.extractedData && (
                      <div className="mt-2 flex gap-4 flex-wrap">
                        {(doc.extractedData.supplierName || doc.extractedData.clientName) && (
                          <span className="text-xs text-[#a1a1aa]">
                            🏢 {doc.extractedData.supplierName || doc.extractedData.clientName}
                          </span>
                        )}
                        {doc.extractedData.invoiceNo && (
                          <span className="text-xs text-[#a1a1aa] font-mono">
                            № {doc.extractedData.invoiceNo}
                          </span>
                        )}
                        {doc.extractedData.amount != null && (
                          <span className="text-xs font-bold text-[#30d158]">
                            {doc.extractedData.amount.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} {doc.extractedData.currency || 'BGN'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions - only for PENDING */}
                {activeStatus === 'PENDING' && (
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => updateStatus.mutate({ id: doc.id, status: 'PROCESSED' })}
                      disabled={updateStatus.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(48,209,88,0.1)] hover:bg-[rgba(48,209,88,0.2)] border border-[rgba(48,209,88,0.2)] text-[#30d158] text-xs font-semibold transition-all disabled:opacity-50"
                    >
                      <CheckCircle size={13} /> Одобри
                    </button>
                    <button
                      onClick={() => updateStatus.mutate({ id: doc.id, status: 'REJECTED' })}
                      disabled={updateStatus.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,69,58,0.1)] hover:bg-[rgba(255,69,58,0.2)] border border-[rgba(255,69,58,0.2)] text-[#ff453a] text-xs font-semibold transition-all disabled:opacity-50"
                    >
                      <XCircle size={13} /> Отхвърли
                    </button>
                  </div>
                )}

                {/* Status badge for non-pending */}
                {activeStatus !== 'PENDING' && (
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
          ))}
        </div>
      )}
    </div>
  );
}
