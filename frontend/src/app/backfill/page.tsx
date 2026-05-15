'use client';
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Mail, FolderOpen, RefreshCw, CheckCircle, Clock, AlertCircle, Upload, Link2, ArrowRightLeft } from 'lucide-react';
import { api } from '@/lib/api';

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  DONE:        { label: 'Готово',      color: '#30d158', icon: <CheckCircle size={14} /> },
  IN_PROGRESS: { label: 'В процес',   color: '#0a84ff', icon: <RefreshCw size={14} className="animate-spin" /> },
  PARTIAL:     { label: 'Частично',   color: '#ff9f0a', icon: <AlertCircle size={14} /> },
  PENDING:     { label: 'Чакащо',     color: '#636366', icon: <Clock size={14} /> },
};

export default function BackfillPage() {
  const qc = useQueryClient();
  const [selectedYear, setSelectedYear] = useState(2026);
  const [driveFolder, setDriveFolder] = useState({ id: '', path: '', year: 2026 });
  const [inventoryRows, setInventoryRows] = useState('');
  const [log, setLog] = useState<string[]>([]);

  const addLog = (msg: string) => setLog(prev => [`${new Date().toLocaleTimeString('bg')} — ${msg}`, ...prev.slice(0, 49)]);

  const { data: coverage } = useQuery({
    queryKey: ['coverage'],
    queryFn: () => api.get('/backfill/coverage').then(r => r.data),
    refetchInterval: 15000, // poll every 15s (was 5s — too aggressive)
  });

  const { data: sourceFiles } = useQuery({
    queryKey: ['source-files'],
    queryFn: () => api.get('/backfill/source-files?type=GMAIL').then(r => r.data),
  });

  const gmailBackfill = useMutation({
    mutationFn: (year: number) => api.post(`/backfill/gmail/${year}`).then(r => r.data),
    onSuccess: (data: any) => {
      if (data.jobId) {
        addLog(`⏳ Gmail backfill started (job: ${data.jobId}). Ще се обнови автоматично.`);
      } else {
        addLog(`✅ Gmail ${data.year}: намерени ${data.totalFound}, записани ${data.totalDone}, пропуснати ${data.skipped}`);
      }
      qc.invalidateQueries({ queryKey: ['coverage'] });
      qc.invalidateQueries({ queryKey: ['source-files'] });
    },
    onError: (e: any) => addLog(`❌ Gmail грешка: ${e.message}`),
  });

  const driveBackfillMut = useMutation({
    mutationFn: (data: typeof driveFolder) => api.post('/backfill/drive', data).then(r => r.data),
    onSuccess: (data: any) => {
      addLog(`✅ Drive ${data.folderPath ?? ''}: намерени ${data.totalFound ?? '?'}, записани ${data.totalDone ?? '?'}`);
      qc.invalidateQueries({ queryKey: ['coverage'] });
    },
    onError: (e: any) => addLog(`❌ Drive грешка: ${e.message}`),
  });

  const inventoryImport = useMutation({
    mutationFn: (rows: object[]) => api.post('/backfill/inventory', { rows }).then(r => r.data),
    onSuccess: (data: any) => {
      addLog(`✅ Наличности: вкарани ${data.created}, грешки ${data.errors?.length ?? 0}`);
      if (data.errors?.length) data.errors.forEach((e: string) => addLog(`  ⚠ ${e}`));
    },
    onError: (e: any) => addLog(`❌ Inventory грешка: ${e.message}`),
  });

  const parseAndImport = () => {
    try {
      const rows = JSON.parse(inventoryRows);
      if (!Array.isArray(rows)) { addLog('❌ Очаква се JSON масив от редове'); return; }
      inventoryImport.mutate(rows);
    } catch {
      addLog('❌ Невалиден JSON');
    }
  };

  // Run-all pipeline state
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
      addLog(`⏳ Пълен импорт стартиран (job: ${data.jobId}). ~5-15 мин...`);
      setRunAllJobId(data.jobId);
      setRunAllJob({ status: 'running', log: [] });
    },
    onError: (e: any) => addLog(`❌ Грешка: ${e.message}`),
  });

  // Reconciliation tools state
  const [reconJobId, setReconJobId] = useState<string | null>(null);
  const [reconJob, setReconJob] = useState<any>(null);

  useEffect(() => {
    if (!reconJobId || reconJob?.status === 'done' || reconJob?.status === 'error') return;
    const iv = setInterval(async () => {
      try {
        const { data } = await api.get(`/backfill/job/${reconJobId}`);
        setReconJob(data);
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(iv);
          addLog(data.status === 'done'
            ? `✅ ${data.type}: ${JSON.stringify(data.result)}`
            : `❌ ${data.type}: ${data.error}`);
        }
      } catch {}
    }, 2000);
    return () => clearInterval(iv);
  }, [reconJobId, reconJob?.status]);

  const migratePurchases = useMutation({
    mutationFn: () => api.post('/backfill/purchases-to-bizdocs', { includePurchases: true, includeInvoices: true }).then(r => r.data),
    onSuccess: (data: any) => {
      addLog(`⏳ Migration started (job: ${data.jobId})`);
      setReconJobId(data.jobId);
      setReconJob({ status: 'running', log: [] });
    },
    onError: (e: any) => addLog(`❌ Migration грешка: ${e.message}`),
  });

  const linkCounterparties = useMutation({
    mutationFn: () => api.post('/backfill/link-counterparties', { dryRun: false }).then(r => r.data),
    onSuccess: (data: any) => {
      addLog(`⏳ CP linking started (job: ${data.jobId})`);
      setReconJobId(data.jobId);
      setReconJob({ status: 'running', log: [] });
    },
    onError: (e: any) => addLog(`❌ CP linking грешка: ${e.message}`),
  });

  const summary = coverage?.summary;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Backfill & Coverage</h1>
      <p style={{ color: '#8e8e93', marginBottom: 24, fontSize: 14 }}>
        Gmail и Drive обхождане — записва исторически файлове в нормализираната база
      </p>

      {/* ── Import Everything ──────────────────────────────────────────── */}
      <div style={{ background: 'linear-gradient(135deg, #1c1c1e 0%, #2c2c2e 100%)', borderRadius: 14, padding: 20, marginBottom: 24, border: '1px solid #3a3a3c' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              🚀 Импортирай всичко
            </h2>
            <p style={{ color: '#8e8e93', fontSize: 13, margin: 0 }}>
              Gmail 2023–2026 → Drive → Парсинг → Поправи нули → Reconcile → Sync статуси
            </p>
          </div>
          <button
            onClick={() => runAll.mutate()}
            disabled={runAll.isPending || runAllJob?.status === 'running'}
            style={{
              background: runAllJob?.status === 'done'
                ? '#30d158'
                : 'linear-gradient(135deg, #0a84ff, #0066cc)',
              color: '#fff',
              border: '2px solid rgba(255,255,255,0.15)',
              borderRadius: 12,
              padding: '14px 32px',
              fontSize: 16,
              fontWeight: 700,
              cursor: runAll.isPending || runAllJob?.status === 'running' ? 'not-allowed' : 'pointer',
              opacity: runAll.isPending || runAllJob?.status === 'running' ? 0.65 : 1,
              minWidth: 220,
              boxShadow: '0 4px 20px rgba(10,132,255,0.35)',
              letterSpacing: '0.3px',
            }}
          >
            {runAllJob?.status === 'running' ? '⏳ Върви...' : runAllJob?.status === 'done' ? '✅ Готово' : '🚀 Стартирай пълен импорт'}
          </button>
        </div>

        {runAllJob && (
          <div style={{ marginTop: 16 }}>
            {/* Progress bar */}
            {runAllJob.status === 'running' && (
              <div style={{ background: '#2c2c2e', borderRadius: 4, height: 6, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{ background: '#0a84ff', height: '100%', width: '100%', backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(255,255,255,0.15) 8px, rgba(255,255,255,0.15) 16px)', animation: 'slide 1s linear infinite' }} />
              </div>
            )}
            {/* Log */}
            <div style={{ background: '#000', borderRadius: 8, padding: '10px 14px', maxHeight: 200, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12, color: '#a0a0a0' }}>
              {(runAllJob.log || []).slice().reverse().map((line: string, i: number) => (
                <div key={i} style={{ color: line.startsWith('✅') ? '#30d158' : line.startsWith('⚠') ? '#ff9f0a' : line.startsWith('▶') ? '#0a84ff' : '#a0a0a0', marginBottom: 2 }}>
                  {line}
                </div>
              ))}
              {runAllJob.log?.length === 0 && <div style={{ color: '#636366' }}>Изчакване на първи резултати...</div>}
            </div>
          </div>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
          {[
            { label: 'Общо записи', value: summary.total, icon: <Database size={16} /> },
            { label: 'Готови', value: summary.done, icon: <CheckCircle size={16} color="#30d158" /> },
            { label: 'Намерени файлове', value: summary.totalFiles, icon: <FolderOpen size={16} /> },
            { label: 'Обработени', value: summary.processedFiles, icon: <CheckCircle size={16} /> },
          ].map(card => (
            <div key={card.label} style={{ background: '#1c1c1e', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#8e8e93', fontSize: 12, marginBottom: 6 }}>
                {card.icon} {card.label}
              </div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Coverage table */}
      {coverage?.records && (
        <div style={{ background: '#1c1c1e', borderRadius: 12, padding: 16, marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>📊 Coverage статус</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#8e8e93', borderBottom: '1px solid #2c2c2e' }}>
                {['Источник', 'Папка / Label', 'Година', 'Статус', 'Намерени', 'Обработени', '%'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {coverage.records.map((r: any) => {
                const cfg = statusConfig[r.status] || statusConfig.PENDING;
                const pct = r.itemsFound > 0 ? Math.round(r.itemsDone / r.itemsFound * 100) : 0;
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #2c2c2e' }}>
                    <td style={{ padding: '6px 8px' }}>
                      {r.source === 'GMAIL' ? <Mail size={13} style={{ marginRight: 4 }} /> : <FolderOpen size={13} style={{ marginRight: 4 }} />}
                      {r.source}
                    </td>
                    <td style={{ padding: '6px 8px', color: '#8e8e93' }}>{r.path}</td>
                    <td style={{ padding: '6px 8px' }}>{r.year}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: cfg.color }}>
                        {cfg.icon} {cfg.label}
                      </span>
                    </td>
                    <td style={{ padding: '6px 8px' }}>{r.itemsFound}</td>
                    <td style={{ padding: '6px 8px' }}>{r.itemsDone}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ background: '#2c2c2e', borderRadius: 4, height: 6, width: 60, overflow: 'hidden' }}>
                          <div style={{ background: cfg.color, height: '100%', width: `${pct}%`, transition: 'width 0.3s' }} />
                        </div>
                        {pct}%
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        {/* Gmail backfill */}
        <div style={{ background: '#1c1c1e', borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={16} /> Gmail Backfill
          </h2>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, color: '#8e8e93' }}>Година</label>
            <select value={selectedYear} onChange={e => setSelectedYear(+e.target.value)}
              style={{ display: 'block', width: '100%', marginTop: 4, background: '#2c2c2e', border: 'none', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 14 }}>
              {[2026, 2025, 2024].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button
            onClick={() => { addLog(`🔄 Стартирам Gmail backfill за ${selectedYear}...`); gmailBackfill.mutate(selectedYear); }}
            disabled={gmailBackfill.isPending}
            style={{ width: '100%', padding: '10px 0', background: '#0a84ff', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: gmailBackfill.isPending ? 'not-allowed' : 'pointer', opacity: gmailBackfill.isPending ? 0.6 : 1 }}>
            {gmailBackfill.isPending ? 'Сканира...' : `Сканирай Gmail ${selectedYear}`}
          </button>
          <p style={{ fontSize: 11, color: '#636366', marginTop: 8 }}>
            Търси прикачени файлове с бизнес ключови думи. Пропуска промоции и бюлетини.
          </p>
        </div>

        {/* Drive backfill */}
        <div style={{ background: '#1c1c1e', borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderOpen size={16} /> Drive Backfill
          </h2>
          {[
            { label: 'Folder ID (от Drive URL)', key: 'id', placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms' },
            { label: 'Четлив път', key: 'path', placeholder: 'Drive/2026/Invoices' },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#8e8e93' }}>{f.label}</label>
              <input value={(driveFolder as any)[f.key]} onChange={e => setDriveFolder(prev => ({ ...prev, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                style={{ display: 'block', width: '100%', marginTop: 4, background: '#2c2c2e', border: 'none', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 12, boxSizing: 'border-box' }} />
            </div>
          ))}
          <select value={driveFolder.year} onChange={e => setDriveFolder(prev => ({ ...prev, year: +e.target.value }))}
            style={{ width: '100%', background: '#2c2c2e', border: 'none', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 14, marginBottom: 10 }}>
            {[2026, 2025, 2024].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button
            onClick={() => { addLog(`🔄 Drive scan: ${driveFolder.path}...`); driveBackfillMut.mutate(driveFolder); }}
            disabled={driveBackfillMut.isPending || !driveFolder.id}
            style={{ width: '100%', padding: '10px 0', background: '#30d158', border: 'none', borderRadius: 8, color: '#000', fontWeight: 600, cursor: (!driveFolder.id || driveBackfillMut.isPending) ? 'not-allowed' : 'pointer', opacity: (!driveFolder.id || driveBackfillMut.isPending) ? 0.6 : 1 }}>
            {driveBackfillMut.isPending ? 'Сканира...' : 'Сканирай папка'}
          </button>
        </div>
      </div>

      {/* ── Reconciliation Tools ──────────────────────────────────────────── */}
      <div style={{ background: '#1c1c1e', borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <ArrowRightLeft size={16} /> Reconciliation Tools
        </h2>
        <p style={{ fontSize: 12, color: '#8e8e93', marginBottom: 14 }}>
          Стъпки за настройка на bank reconciliation: (1) мигрирай → (2) свържи CP → (3) пусни Auto-Match в Reconciliation страницата
        </p>

        {/* Job progress */}
        {reconJob && reconJob.status === 'running' && (
          <div style={{ background: '#2c2c2e', borderRadius: 8, padding: 10, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#0a84ff', fontSize: 13, marginBottom: 6 }}>
              <RefreshCw size={13} className="animate-spin" /> В процес...
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#ebebf5cc', maxHeight: 80, overflow: 'auto' }}>
              {reconJob.log?.slice(-8).map((l: string, i: number) => <div key={i}>{l}</div>)}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Step 1: Migrate purchases */}
          <div style={{ background: '#2c2c2e', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: '#0a84ff', color: '#fff', width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>1</span>
              Покупки → BizDocuments
            </div>
            <p style={{ fontSize: 11, color: '#8e8e93', marginBottom: 10 }}>
              Конвертира 259 Purchase + 69 Invoice записа в BizDocument модела. Нужно еднократно.
            </p>
            <button
              onClick={() => migratePurchases.mutate()}
              disabled={migratePurchases.isPending || reconJob?.status === 'running'}
              style={{ width: '100%', padding: '9px 0', background: '#0a84ff', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: (migratePurchases.isPending || reconJob?.status === 'running') ? 0.5 : 1 }}>
              {reconJob?.status === 'running' ? 'В процес...' : 'Мигрирай'}
            </button>
          </div>

          {/* Step 2: Link counterparties */}
          <div style={{ background: '#2c2c2e', borderRadius: 8, padding: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ background: '#30d158', color: '#000', width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>2</span>
              Свържи банкови контрагенти
            </div>
            <p style={{ fontSize: 11, color: '#8e8e93', marginBottom: 10 }}>
              Fuzzy match 120 банкови контрагенти (ЛОДЕС ЕООД) → наши доставчици (Lodes). Подобрява Step 2 matching.
            </p>
            <button
              onClick={() => linkCounterparties.mutate()}
              disabled={linkCounterparties.isPending || reconJob?.status === 'running'}
              style={{ width: '100%', padding: '9px 0', background: '#30d158', border: 'none', borderRadius: 8, color: '#000', fontWeight: 600, cursor: 'pointer', opacity: (linkCounterparties.isPending || reconJob?.status === 'running') ? 0.5 : 1 }}>
              {reconJob?.status === 'running' ? 'В процес...' : 'Свържи контрагенти'}
            </button>
          </div>
        </div>
      </div>

      {/* Inventory import */}
      <div style={{ background: '#1c1c1e', borderRadius: 12, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Upload size={16} /> Наличности 2026 — JSON Import
        </h2>
        <p style={{ fontSize: 12, color: '#8e8e93', marginBottom: 10 }}>
          Постави JSON масив от редове: <code style={{ background: '#2c2c2e', padding: '1px 5px', borderRadius: 4 }}>[&#123;"code":"XXX","name":"...","supplier":"Lodes","qtyIn":5,"unit":"бр"&#125;, ...]</code>
        </p>
        <textarea value={inventoryRows} onChange={e => setInventoryRows(e.target.value)}
          placeholder='[{"code":"ITEM-001","name":"LED лента WW 24V","supplier":"Alphaluce","qtyIn":50,"unit":"м"}]'
          rows={5}
          style={{ width: '100%', background: '#2c2c2e', border: 'none', borderRadius: 8, padding: 10, color: '#fff', fontSize: 12, resize: 'vertical', boxSizing: 'border-box', marginBottom: 10, fontFamily: 'monospace' }} />
        <button onClick={parseAndImport} disabled={inventoryImport.isPending || !inventoryRows.trim()}
          style={{ padding: '9px 20px', background: '#ff9f0a', border: 'none', borderRadius: 8, color: '#000', fontWeight: 600, cursor: 'pointer' }}>
          {inventoryImport.isPending ? 'Вкарва...' : 'Вкарай наличности'}
        </button>
      </div>

      {/* Activity log */}
      {log.length > 0 && (
        <div style={{ background: '#1c1c1e', borderRadius: 12, padding: 16 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>📋 Лог</h2>
          {log.map((entry, i) => (
            <div key={i} style={{ fontSize: 12, color: '#ebebf5cc', fontFamily: 'monospace', marginBottom: 3 }}>{entry}</div>
          ))}
        </div>
      )}
    </div>
  );
}
