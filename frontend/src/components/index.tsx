'use client';
import { statusConfig, fmt, fmtDate } from '@/lib/api';
import { useState } from 'react';

// ─── KPI Card ─────────────────────────────────────────────────────────────────
const colorMap: Record<string, string> = {
  green: '#30d158', red: '#ff453a', blue: '#0a84ff', orange: '#ff9f0a', purple: '#bf5af2'
};

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

export function KPICard({ label, value, sub, color, icon }: {
  label: string; value: string | number; sub?: string; color?: string; icon?: React.ReactNode;
}) {
  const c = colorMap[color || 'blue'];
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#71717a] leading-tight">{label}</span>
        <div
          style={{
            width: 24, height: 24, borderRadius: 6,
            background: `rgba(${hexToRgb(c)}, 0.15)`,
            color: c,
          }}
          className="flex items-center justify-center flex-shrink-0 ml-2"
        >
          <span style={{ fontSize: 12 }}>{icon}</span>
        </div>
      </div>
      <div
        className="font-bold tracking-tight text-white"
        style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-[#52525b] mt-1">{sub}</div>}
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || { label: status, color: '#8e8e93', bg: 'rgba(142,142,147,0.15)' };
  return (
    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold"
      style={{ background: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

// ─── Revenue Chart ────────────────────────────────────────────────────────────
const MONTHS = ['Яну','Фев','Мар','Апр','Май','Юни','Юли','Авг','Сеп','Окт','Ное','Дек'];

export function RevenueChart({ data }: { data: any[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: MONTHS[i], revenue: 0 }));
  data.forEach(d => {
    const idx = parseInt(d.month) - 1;
    if (idx >= 0 && idx < 12) monthly[idx].revenue = Number(d.revenue);
  });
  const maxVal = Math.max(...monthly.map(d => d.revenue), 1);
  const BAR_H = 155;

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: BAR_H + 24, position: 'relative' }}>
      {monthly.map((d, i) => {
        const barH = (d.revenue / maxVal) * BAR_H;
        const isHov = hovered === i;
        return (
          <div
            key={i}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, position: 'relative', cursor: 'default' }}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            {isHov && d.revenue > 0 && (
              <div style={{
                position: 'absolute', bottom: BAR_H + 4, left: '50%', transform: 'translateX(-50%)',
                background: '#1d1d1f', border: '1px solid #27272a', borderRadius: 8,
                padding: '5px 8px', whiteSpace: 'nowrap', fontSize: 11, color: '#e4e4e7',
                zIndex: 10, pointerEvents: 'none',
              }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>{MONTHS[i]}</div>
                <div style={{ color: '#0a84ff' }}>{fmt(d.revenue)} EUR</div>
              </div>
            )}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: BAR_H, gap: 2 }}>
              {d.revenue > 0 ? (
                <div style={{
                  width: '100%', height: barH,
                  borderRadius: '4px 4px 0 0',
                  background: 'linear-gradient(to bottom, #0a84ff, rgba(10,132,255,0.5))',
                  opacity: isHov ? 1 : 0.85,
                  transition: 'opacity 0.15s',
                }} />
              ) : (
                <div style={{ width: '100%', height: 2, background: '#27272a', borderRadius: 2 }} />
              )}
            </div>
            <div style={{ fontSize: 9, color: isHov ? '#a1a1aa' : '#52525b', letterSpacing: '0.03em', transition: 'color 0.15s' }}>
              {MONTHS[i]}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Top Clients Chart ────────────────────────────────────────────────────────
const COLORS = ['#0a84ff','#30d158','#ff9f0a','#bf5af2','#ff453a','#5e5ce6','#636366'];

export function TopClientsChart({ data }: { data: { name: string; revenue: number }[] }) {
  const max = Math.max(...data.map(d => d.revenue), 1);
  return (
    <div className="space-y-3">
      {data.slice(0, 7).map((d, i) => (
        <div key={d.name}>
          <div className="flex justify-between mb-1">
            <span className="text-xs text-[#a1a1aa] truncate max-w-[140px]">{d.name}</span>
            <span className="text-xs font-bold text-white ml-2">{(d.revenue/1000).toFixed(0)}k</span>
          </div>
          <div className="h-1.5 bg-[#27272a] rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all"
              style={{ width: `${d.revenue/max*100}%`, background: COLORS[i % COLORS.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Recent Invoices ──────────────────────────────────────────────────────────
export function RecentInvoices({ invoices, showStatus }: { invoices: any[]; showStatus?: boolean }) {
  if (!invoices?.length) return <div className="p-5 text-sm text-[#52525b]">Няма фактури</div>;
  return (
    <div>
      {invoices.slice(0, 8).map(inv => (
        <div key={inv.id} className="flex items-center justify-between px-5 py-3 border-b border-[#1a1a1c] hover:bg-[#1d1d1f] transition-colors">
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{inv.client?.name || '—'}</div>
            <div className="text-xs text-[#71717a]">{fmtDate(inv.date)} · {inv.number}</div>
          </div>
          <div className="flex flex-col items-end ml-4 flex-shrink-0">
            <span className="text-sm font-bold text-white">{fmt(inv.currency === 'BGN' ? Number(inv.amountNet) / 1.95583 : Number(inv.amountNet))} EUR</span>
            {showStatus && <StatusBadge status={inv.status} />}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Pending Documents ────────────────────────────────────────────────────────
export function PendingDocuments({ docs }: { docs: any[] }) {
  return (
    <div className="space-y-2">
      {docs?.map(doc => (
        <div key={doc.id} className="card p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white">{doc.filename}</div>
            <div className="text-xs text-[#71717a] mt-1">
              {doc.extractedData?.supplierName || doc.extractedData?.clientName || '—'} · {doc.extractedData?.amount != null ? Number(doc.extractedData.amount).toLocaleString('bg-BG', { minimumFractionDigits: 2 }) : '—'} {doc.extractedData?.currency}
            </div>
          </div>
          <a href="/documents" className="btn-secondary text-xs py-1 px-3">Преглед</a>
        </div>
      ))}
    </div>
  );
}
