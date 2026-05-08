'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate } from '@/lib/api';
import { useT } from '@/lib/i18n';

function getSeverityConfig(t: ReturnType<typeof useT>): Record<string, { label: string; icon: string; cls: string }> {
  return {
    CRITICAL: { label: t('alerts.critical'), icon: 'error', cls: 'text-error bg-error/10 border-error/30' },
    WARNING: { label: t('alerts.warning'), icon: 'warning', cls: 'text-[#ff9f0a] bg-[#ff9f0a]/10 border-[#ff9f0a]/30' },
    INFO: { label: t('alerts.info'), icon: 'info', cls: 'text-primary bg-primary/10 border-primary/30' },
  };
}

const typeLabels: Record<string, string> = {
  DOCUMENT: 'Документ', VAT: 'ДДС', REVENUE: 'Приходи',
  EXPENSE: 'Разходи', PROJECT: 'Проект', DATA_QUALITY: 'Данни',
};

const STATUS_TABS = [
  { key: 'ACTIVE', labelKey: 'alerts.active' },
  { key: 'SNOOZED', labelKey: 'alerts.snoozed' },
  { key: 'RESOLVED', labelKey: 'alerts.resolved' },
] as const;

export default function AlertsPage() {
  const [status, setStatus] = useState('ACTIVE');
  const qc = useQueryClient();
  const t = useT();
  const severityConfig = getSeverityConfig(t);

  const { data: alerts = [], isLoading } = useQuery({
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
    const d = new Date(); d.setDate(d.getDate() + 1);
    updateAlert.mutate({ id, payload: { snoozedUntil: d.toISOString() } });
  };

  const activeCount  = (alerts as any[]).filter((a: any) => a.severity === 'CRITICAL').length;

  return (
    <div className="p-container-padding space-y-8">

      {/* Header */}
      <section className="flex justify-between items-end">
        <div>
          <p className="font-label-caps text-label-caps text-primary mb-2">{t('alerts.label')}</p>
          <h2 className="font-headline text-headline-lg text-on-surface">{t('alerts.title')}</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            {t('alerts.subtitle')}
          </p>
        </div>
        <button
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          className="btn-secondary flex items-center gap-2"
        >
          <span className={`material-symbols-outlined text-[18px] ${generate.isPending ? 'animate-spin' : ''}`}>
            refresh
          </span>
          {t('alerts.refresh')}
        </button>
      </section>

      {/* Critical count banner */}
      {status === 'ACTIVE' && activeCount > 0 && (
        <div className="bg-error/5 border border-error/20 border-l-4 border-l-error p-4 flex items-center gap-3">
          <span className="material-symbols-outlined text-error text-[20px]">error</span>
          <span className="font-label-caps text-label-caps text-on-surface">
            {activeCount} КРИТИЧН{activeCount === 1 ? 'И' : 'И'} СИГНАЛА ИЗИСКВАТ НЕЗАБАВНА РЕАКЦИЯ
          </span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1 border border-outline-variant/20 bg-surface-container p-1 w-fit">
        {STATUS_TABS.map(({ key, labelKey }) => (
          <button
            key={key}
            onClick={() => setStatus(key)}
            className={`px-5 py-1.5 font-label-caps text-label-caps transition-colors ${
              status === key
                ? 'bg-primary-container text-on-primary-container'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Alert list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-surface-container-low border border-outline-variant/10 animate-pulse" />
          ))}
        </div>
      ) : !(alerts as any[]).length ? (
        <div className="bg-surface-container-low border border-outline-variant/10 p-16 flex flex-col items-center text-center">
          <span className="material-symbols-outlined text-primary text-5xl mb-4">check_circle</span>
          <p className="font-label-caps text-label-caps text-on-surface mb-1">{t('alerts.allClear')}</p>
          <p className="font-body-sm text-body-sm text-on-surface-variant">{t('alerts.noAlerts')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(alerts as any[]).map((alert: any) => {
            const sev = severityConfig[alert.severity] || severityConfig.INFO;
            return (
              <div
                key={alert.id}
                className="bg-surface-container-low border border-outline-variant/10 p-5 hover:border-outline-variant/20 transition-colors group"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex gap-4 min-w-0">

                    {/* Severity icon */}
                    <div className={`w-10 h-10 flex items-center justify-center flex-shrink-0 border ${sev.cls}`}>
                      <span className="material-symbols-outlined text-[20px]">{sev.icon}</span>
                    </div>

                    <div className="min-w-0 flex-1">
                      {/* Meta row */}
                      <div className="flex items-center gap-3 flex-wrap mb-2">
                        <span className={`px-2 py-0.5 font-label-caps text-[9px] border ${sev.cls}`}>
                          {sev.label}
                        </span>
                        <span className="font-label-caps text-[9px] text-on-surface-variant">
                          {typeLabels[alert.type] || alert.type}
                        </span>
                        <span className="font-label-caps text-[9px] text-on-surface-variant/50 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[12px]">schedule</span>
                          {fmtDate(alert.detectedAt)}
                        </span>
                      </div>

                      <h3 className="font-body-sm text-on-surface text-[14px] font-medium">{alert.title}</h3>
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">{alert.description}</p>

                      {alert.document && (
                        <a
                          href={alert.document.driveUrl || '/documents'}
                          target="_blank"
                          className="inline-flex items-center gap-1.5 mt-3 font-label-caps text-[9px] text-primary hover:text-primary/80 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[14px]">description</span>
                          {alert.document.filename}
                        </a>
                      )}
                    </div>
                  </div>

                  {status !== 'RESOLVED' && (
                    <div className="flex gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => snoozeTomorrow(alert.id)}
                        className="btn-secondary text-xs py-1.5 px-3"
                      >
                        {t('alerts.snooze')}
                      </button>
                      <button
                        onClick={() => updateAlert.mutate({ id: alert.id, payload: { status: 'RESOLVED' } })}
                        className="btn-primary text-xs py-1.5 px-3"
                      >
                        {t('alerts.resolve')}
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
