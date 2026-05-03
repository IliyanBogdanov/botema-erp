'use client';
import { statusConfig, fmt, fmtDate } from '@/lib/api';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

// ─── KPI Card ─────────────────────────────────────────────────────────────────
const colorMap: Record<string, string> = {
  green: '#30d158', red: '#ff453a', blue: '#0a84ff', orange: '#ff9f0a', purple: '#bf5af2'
};

export function KPICard({ label, value, sub, color, icon }: {
  label: string; value: string | number; sub?: string; color?: string; icon?: React.ReactNode;
}) {
  const c = colorMap[color || 'blue'];
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#71717a]">{label}</span>
        <span style={{ color: c }} className="opacity-70">{icon}</span>
      </div>
      <div className="text-2xl font-extrabold tracking-tight" style={{ color: c }}>{value}</div>
      {sub && <div className="text-xs text-[#52525b] mt-1">{sub}</div>}
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
  const monthly = Array.from({ length: 12 }, (_, i) => ({
    month: MONTHS[i],
    SB: 0, LV: 0
  }));
  data.forEach(d => {
    const idx = parseInt(d.month) - 1;
    if (idx >= 0 && idx < 12) {
      monthly[idx][d.brand === 'LUMINAVERA' ? 'LV' : 'SB'] = Number(d.revenue);
    }
  });
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={monthly} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
        <XAxis dataKey="month" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip
          contentStyle={{ background: '#1d1d1f', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#e4e4e7' }}
          formatter={(v: number) => [fmt(v, 'BGN'), '']}
        />
        <Bar dataKey="SB" fill="#0a84ff" radius={[3,3,0,0]} name="Studio Botema" />
        <Bar dataKey="LV" fill="#30d158" radius={[3,3,0,0]} name="Luminavera" />
      </BarChart>
    </ResponsiveContainer>
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
            <span className="text-sm font-bold text-white">{fmt(inv.amountNet, inv.currency || 'BGN')}</span>
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
              {doc.extractedData?.supplierName || doc.extractedData?.clientName || '—'} · {doc.extractedData?.amount} {doc.extractedData?.currency}
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-xs py-1 px-3">✓ Одобри</button>
            <button className="btn-secondary text-xs py-1 px-3">✗</button>
          </div>
        </div>
      ))}
    </div>
  );
}
