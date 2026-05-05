'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Clock, FileText, RefreshCw } from 'lucide-react';
import { api, fmtDate } from '@/lib/api';

const severityConfig: Record<string, { label: string; color: string }> = {
  CRITICAL: { label: 'Критичен', color: '#ff453a' },
  WARNING: { label: 'Внимание', color: '#ff9f0a' },
  INFO: { label: 'Инфо', color: '#0a84ff' },
};

const typeLabels: Record<string, string> = {
  DOCUMENT: 'Документ',
  VAT: 'ДДС',
  REVENUE: 'Приходи',
  EXPENSE: 'Разходи',
  PROJECT: 'Проект',
  DATA_QUALITY: 'Данни',
};

export default function AlertsPage() {
  const [status, setStatus] = useState('ACTIVE');
  const qc = useQueryClient();

  const { data: alerts = [], isLoading, refetch } = useQuery({
    queryKey: ['alerts', status],
    queryFn: () => api.get(`/alerts?status=${status}`).then(r => r.data),
    refetchInterval: status === 'ACTIVE' ? 60000 : undefined,
  });

  const updateAlert = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) => api.patch(`/alerts/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-sidebar'] });
    },
  });

  const generate = useMutation({
    mutationFn: () => api.post('/alerts/generate'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-sidebar'] });
    },
  });

  const snoozeTomorrow = (id: string) => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    updateAlert.mutate({ id, payload: { snoozedUntil: d.toISOString() } });
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Сигнали</h1>
          <p className="text-[#71717a] text-sm mt-0.5">Проблеми, ДДС рискове и пропуснати документи</p>
        </div>
        <button onClick={() => generate.mutate()} disabled={generate.isPending} className="btn-secondary flex items-center gap-2">
          <RefreshCw size={15} className={generate.isPending ? 'animate-spin' : ''} /> Обнови анализа
        </button>
      </div>

      <div className="flex gap-1 bg-[#1d1d1f] p-1 rounded-xl mb-6 w-fit">
        {['ACTIVE', 'SNOOZED', 'RESOLVED'].map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
              status === s ? 'bg-[#0a84ff] text-white' : 'text-[#71717a] hover:text-white'
            }`}>
            {s === 'ACTIVE' ? 'Активни' : s === 'SNOOZED' ? 'Отложени' : 'Решени'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-3">
          {[...Array(4)].map((_, i) => <div key={i} className="card p-5 h-24 animate-pulse" />)}
        </div>
      ) : !alerts.length ? (
        <div className="card p-12 text-center">
          <CheckCircle size={40} className="mx-auto text-[#30d158] mb-3" />
          <p className="text-[#a1a1aa] font-medium">Няма сигнали в тази категория</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {alerts.map((alert: any) => {
            const sev = severityConfig[alert.severity] || severityConfig.INFO;
            return (
              <div key={alert.id} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ color: sev.color, background: `${sev.color}22`, border: `1px solid ${sev.color}33` }}>
                      <AlertTriangle size={18} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md"
                          style={{ color: sev.color, background: `${sev.color}18` }}>
                          {sev.label}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#71717a]">
                          {typeLabels[alert.type] || alert.type}
                        </span>
                        <span className="text-xs text-[#52525b] flex items-center gap-1">
                          <Clock size={11} /> {fmtDate(alert.detectedAt)}
                        </span>
                      </div>
                      <h2 className="text-base font-semibold text-white mt-2">{alert.title}</h2>
                      <p className="text-sm text-[#a1a1aa] mt-1">{alert.description}</p>
                      {alert.document && (
                        <a href={alert.document.driveUrl || '/documents'} target="_blank" className="inline-flex items-center gap-1 text-xs text-[#0a84ff] mt-3 hover:underline">
                          <FileText size={12} /> {alert.document.filename}
                        </a>
                      )}
                    </div>
                  </div>
                  {status !== 'RESOLVED' && (
                    <div className="flex gap-2 flex-shrink-0">
                      <button onClick={() => snoozeTomorrow(alert.id)} className="btn-secondary text-xs py-1.5 px-3">Отложи</button>
                      <button onClick={() => updateAlert.mutate({ id: alert.id, payload: { status: 'RESOLVED' } })}
                        className="btn-primary text-xs py-1.5 px-3">
                        Решено
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
