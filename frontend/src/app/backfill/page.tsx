'use client';
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const STATUS_COLORS: Record<string, { label: string; dot: string }> = {
  DONE:        { label: 'Готово',    dot: 'bg-emerald-400' },
  IN_PROGRESS: { label: 'В процес', dot: 'bg-primary animate-pulse' },
  PARTIAL:     { label: 'Частично', dot: 'bg-warning' },
  PENDING:     { label: 'Чакащо',   dot: 'bg-outline-variant' },
};

export default function BackfillPage() {
  const qc = useQueryClient();
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [driveFolder, setDriveFolder] = useState({ id: '', path: '', year: new Date().getFullYear() });
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) =>
    setLog(prev => [`${new Date().toLocaleTimeString('bg')} — ${msg}`, ...prev.slice(0, 49)]);

  const { data: coverage, refetch: refetchCoverage } = useQuery({
    queryKey: ['coverage'],
    queryFn: () => api.get('/backfill/coverage').then(r => r.data),
    refetchInterval: 15000,
  });

  // ── Run-all job ──────────────────────────────────────────────────────────
  const [runAllJobId, setRunAllJobId] = useState<string | null>(null);
  const [runAllJob, setRunAllJob] = useState<any>(null);

  useEffect(() => {
    if (!runAllJobId || runAllJob?.status === 'done' || runAllJob?.status === 'error') return;
    const iv = setInterval(async () => {
      try {
        const { data } = await api.get(`/backfill/job/${runAllJobId}`);
        setRunAllJob(data);
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(iv);
          addLog(data.status === 'done' ? '✅ Пълен импорт завършен!' : `❌ Грешка: ${data.error}`);
          qc.invalidateQueries({ queryKey: ['coverage'] });
        }
      } catch {}
    }, 3000);
    return () => clearInterval(iv);
  }, [runAllJobId, runAllJob?.status]);

  const runAll = useMutation({
    mutationFn: () => api.post('/backfill/run-all').then(r => r.data),
    onSuccess: (data: any) => {
      addLog(`⏳ Пълен импорт стартиран (job: ${data.jobId}). ~5–15 мин...`);
      setRunAllJobId(data.jobId);
      setRunAllJob({ status: 'running', log: [] });
    },
    onError: (e: any) => addLog(`❌ Грешка: ${e.message}`),
  });

  // ── Gmail backfill ────────────────────────────────────────────────────────
  const gmailBackfill = useMutation({
    mutationFn: (year: number) => api.post(`/backfill/gmail/${year}`).then(r => r.data),
    onSuccess: (data: any) => {
      addLog(data.jobId
        ? `⏳ Gmail backfill стартиран (job: ${data.jobId}).`
        : `✅ Gmail ${data.year}: намерени ${data.totalFound}, записани ${data.totalDone}, пропуснати ${data.skipped}`
      );
      qc.invalidateQueries({ queryKey: ['coverage'] });
    },
    onError: (e: any) => addLog(`❌ Gmail грешка: ${e.message}`),
  });

  // ── Drive backfill ────────────────────────────────────────────────────────
  const driveBackfillMut = useMutation({
    mutationFn: (data: typeof driveFolder) => api.post('/backfill/drive', data).then(r => r.data),
    onSuccess: (data: any) => {
      addLog(`✅ Drive ${data.folderPath ?? ''}: намерени ${data.totalFound ?? '?'}, записани ${data.totalDone ?? '?'}`);
      qc.invalidateQueries({ queryKey: ['coverage'] });
    },
    onError: (e: any) => addLog(`❌ Drive грешка: ${e.message}`),
  });

  const summary = coverage?.summary;
  const isRunning = runAllJob?.status === 'running';

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-outline-variant/10 bg-surface-container-lowest sticky top-0 z-10">
        <div className="px-8 py-4">
          <p className="font-label-caps text-label-caps text-primary mb-0.5">АДМІН</p>
          <h1 className="font-headline text-headline-lg text-on-surface">Синхронизация & Покритие</h1>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6 max-w-4xl">

        {/* ── Import Everything ──────────────────────────────────────────────── */}
        <div className="border border-outline-variant/10 bg-surface-container-low p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-headline text-headline-sm text-on-surface mb-1">Импортирай всичко</h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Gmail 2023–2026 → Drive → Парсинг → Поправи нули → Reconcile → Sync статуси
              </p>
            </div>
            <button
              onClick={() => runAll.mutate()}
              disabled={runAll.isPending || isRunning}
              className={`flex items-center gap-2 px-6 py-3 font-label-caps text-label-caps transition-all whitespace-nowrap ${
                runAllJob?.status === 'done'
                  ? 'bg-emerald-500 text-white'
                  : isRunning
                    ? 'bg-surface-container-high text-on-surface-variant opacity-70 cursor-not-allowed'
                    : 'bg-primary text-on-primary hover:bg-primary/90'
              }`}
            >
              <span className={`material-symbols-outlined text-[18px] ${isRunning ? 'animate-spin' : ''}`}>
                {isRunning ? 'sync' : runAllJob?.status === 'done' ? 'check_circle' : 'cloud_sync'}
              </span>
              {isRunning ? 'Върви...' : runAllJob?.status === 'done' ? 'Готово' : 'Стартирай пълен импорт'}
            </button>
          </div>

          {isRunning && (
            <div className="mt-4 h-1 bg-surface-container-highest overflow-hidden">
              <div className="h-full bg-primary animate-pulse w-full" />
            </div>
          )}

          {runAllJob?.log?.length > 0 && (
            <div className="mt-4 bg-surface-container-highest p-3 font-mono text-[11px] text-on-surface-variant/70 max-h-40 overflow-y-auto space-y-0.5">
              {[...(runAllJob.log || [])].reverse().map((line: string, i: number) => (
                <div key={i} className={
                  line.startsWith('✅') ? 'text-emerald-400' :
                  line.startsWith('⚠') ? 'text-warning' :
                  line.startsWith('▶') ? 'text-primary' :
                  'text-on-surface-variant/50'
                }>{line}</div>
              ))}
              {runAllJob.log.length === 0 && (
                <div className="text-on-surface-variant/30">Изчакване на първи резултати...</div>
              )}
            </div>
          )}
        </div>

        {/* ── Coverage summary ───────────────────────────────────────────────── */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Общо записи',      value: summary.total },
              { label: 'Готови',           value: summary.done },
              { label: 'Намерени файлове', value: summary.totalFiles },
              { label: 'Обработени',       value: summary.processedFiles },
            ].map(card => (
              <div key={card.label} className="border border-outline-variant/10 bg-surface-container-low p-4">
                <p className="font-label-caps text-[10px] text-on-surface-variant/60 mb-2">{card.label}</p>
                <p className="font-display text-[28px] leading-none text-on-surface italic">{card.value ?? '—'}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Coverage table ─────────────────────────────────────────────────── */}
        {coverage?.records?.length > 0 && (
          <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
            <div className="px-5 py-3 border-b border-outline-variant/10">
              <p className="font-label-caps text-label-caps text-on-surface-variant">COVERAGE СТАТУС</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-outline-variant/10">
                    {['Източник', 'Папка / Label', 'Година', 'Статус', 'Намерени', 'Обработени', '%'].map(h => (
                      <th key={h} className="table-header text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coverage.records.map((r: any) => {
                    const cfg = STATUS_COLORS[r.status] || STATUS_COLORS.PENDING;
                    const pct = r.itemsFound > 0 ? Math.round(r.itemsDone / r.itemsFound * 100) : 0;
                    return (
                      <tr key={r.id} className="border-b border-outline-variant/5 hover:bg-surface-container-high transition-colors">
                        <td className="table-cell font-label-caps text-[10px]">
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-[14px] text-on-surface-variant">
                              {r.source === 'GMAIL' ? 'mail' : 'folder_open'}
                            </span>
                            {r.source}
                          </div>
                        </td>
                        <td className="table-cell font-label-caps text-[10px] text-on-surface-variant/60">{r.path}</td>
                        <td className="table-cell font-data-mono text-data-mono">{r.year}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            <span className="font-label-caps text-[9px] text-on-surface-variant">{cfg.label}</span>
                          </div>
                        </td>
                        <td className="table-cell font-data-mono text-data-mono text-right">{r.itemsFound}</td>
                        <td className="table-cell font-data-mono text-data-mono text-right">{r.itemsDone}</td>
                        <td className="table-cell">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-surface-container-highest overflow-hidden rounded-full">
                              <div className="h-full bg-primary-container/60 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                            <span className="font-label-caps text-[9px] text-on-surface-variant/60 w-8 text-right">{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Manual controls ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Gmail backfill */}
          <div className="border border-outline-variant/10 bg-surface-container-low p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">mail</span>
              <h3 className="font-label-caps text-label-caps text-on-surface">Gmail Backfill</h3>
            </div>
            <div>
              <label className="font-label-caps text-[9px] text-on-surface-variant/60 block mb-1.5">ГОДИНА</label>
              <select
                value={selectedYear}
                onChange={e => setSelectedYear(+e.target.value)}
                className="w-full border border-outline-variant/30 bg-surface-container px-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary"
              >
                {[0, 1, 2].map(i => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button
              onClick={() => { addLog(`🔄 Gmail backfill за ${selectedYear}...`); gmailBackfill.mutate(selectedYear); }}
              disabled={gmailBackfill.isPending}
              className="w-full py-2.5 bg-primary text-on-primary font-label-caps text-label-caps hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {gmailBackfill.isPending ? 'Сканира...' : `Сканирай Gmail ${selectedYear}`}
            </button>
            <p className="font-body-sm text-[10px] text-on-surface-variant/40">
              Търси прикачени файлове с бизнес ключови думи. Пропуска промоции и бюлетини.
            </p>
          </div>

          {/* Drive backfill */}
          <div className="border border-outline-variant/10 bg-surface-container-low p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">folder_open</span>
              <h3 className="font-label-caps text-label-caps text-on-surface">Drive Backfill</h3>
            </div>
            <div className="space-y-2">
              {[
                { label: 'FOLDER ID', key: 'id', placeholder: '1BxiMVs0XRA5nFM...' },
                { label: 'ЧЕТЛИВ ПЪТ', key: 'path', placeholder: 'Drive/2026/Invoices' },
              ].map(f => (
                <div key={f.key}>
                  <label className="font-label-caps text-[9px] text-on-surface-variant/60 block mb-1">{f.label}</label>
                  <input
                    value={(driveFolder as any)[f.key]}
                    onChange={e => setDriveFolder(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full border border-outline-variant/30 bg-surface-container px-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary placeholder-on-surface-variant/30"
                  />
                </div>
              ))}
              <select
                value={driveFolder.year}
                onChange={e => setDriveFolder(prev => ({ ...prev, year: +e.target.value }))}
                className="w-full border border-outline-variant/30 bg-surface-container px-3 py-2 font-label-caps text-label-caps text-on-surface text-sm focus:outline-none focus:border-primary"
              >
                {[0, 1, 2].map(i => new Date().getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <button
              onClick={() => { addLog(`🔄 Drive scan: ${driveFolder.path}...`); driveBackfillMut.mutate(driveFolder); }}
              disabled={driveBackfillMut.isPending || !driveFolder.id}
              className="w-full py-2.5 bg-primary text-on-primary font-label-caps text-label-caps hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {driveBackfillMut.isPending ? 'Сканира...' : 'Сканирай папка'}
            </button>
          </div>
        </div>

        {/* ── Activity log ───────────────────────────────────────────────────── */}
        {log.length > 0 && (
          <div className="border border-outline-variant/10 bg-surface-container-low p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="font-label-caps text-label-caps text-on-surface-variant">ЛОГ</p>
              <button onClick={() => setLog([])} className="font-label-caps text-[9px] text-on-surface-variant/40 hover:text-on-surface-variant">
                Изчисти
              </button>
            </div>
            <div className="space-y-0.5">
              {log.map((entry, i) => (
                <div key={i} className="font-mono text-[11px] text-on-surface-variant/60">{entry}</div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
