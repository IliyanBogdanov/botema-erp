'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { KPICard } from '@/components/KPICard';
import { RevenueChart } from '@/components/RevenueChart';
import { TopClientsChart } from '@/components/TopClientsChart';
import { RecentInvoices } from '@/components/RecentInvoices';
import { PendingDocuments } from '@/components/PendingDocuments';
import { useState } from 'react';
import { TrendingUp, TrendingDown, Package, Percent, AlertTriangle } from 'lucide-react';

export default function DashboardPage() {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', year],
    queryFn: () => api.get(`/dashboard?year=${year}`).then(r => r.data),
  });

  const { data: pendingDocs } = useQuery({
    queryKey: ['pending-docs'],
    queryFn: () => api.get('/gmail/pending').then(r => r.data),
    refetchInterval: 30000,
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['dashboard-alerts'],
    queryFn: () => api.get('/alerts?status=ACTIVE&limit=5').then(r => r.data),
    refetchInterval: 60000,
  });

  const { data: vat } = useQuery({
    queryKey: ['vat-overview', year],
    queryFn: () => api.get(`/vat/overview?year=${year}`).then(r => r.data),
  });

  if (isLoading) return <LoadingSkeleton />;

  const kpis = data?.kpis || {};
  const margin = parseFloat(kpis.grossMargin || 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Дашборд</h1>
          <p className="text-[#71717a] text-sm mt-1">Studio Botema ЕООД · Преглед {year}</p>
        </div>
        <div className="flex gap-1 bg-[#1d1d1f] p-1 rounded-xl">
          {[2024, 2025, 2026].map(y => (
            <button key={y} onClick={() => setYear(y)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                year === y ? 'bg-[#0a84ff] text-white' : 'text-[#71717a] hover:text-white'
              }`}>
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Pending documents alert */}
      {alerts?.length > 0 && (
        <div className="mb-6 card p-4 border-l-4 border-[#ff453a]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <AlertTriangle size={18} className="text-[#ff453a] flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">{alerts.length} активни сигнала</div>
                <div className="text-xs text-[#a1a1aa] truncate">{alerts[0]?.title}</div>
              </div>
            </div>
            <a href="/alerts" className="text-xs text-[#0a84ff] font-semibold hover:underline flex-shrink-0">Отвори</a>
          </div>
        </div>
      )}

      {/* Pending documents alert */}
      {pendingDocs?.length > 0 && (
        <div className="mb-6 card p-4 border-l-4 border-[#ff9f0a] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#ff9f0a] animate-pulse" />
            <span className="text-sm font-medium text-white">
              {pendingDocs.length} нов{pendingDocs.length > 1 ? 'и документа' : ' документ'} чака преглед
            </span>
          </div>
          <a href="/documents" className="text-xs text-[#0a84ff] font-semibold hover:underline">Прегледай →</a>
        </div>
      )}

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard label="Приходи" value={`${(kpis.revenue || 0).toLocaleString('bg-BG', {minimumFractionDigits: 0})} BGN`}
          sub={`${data?.kpis?.invoiceCount || 0} фактури`} color="green" icon={<TrendingUp size={16} />} />
        <KPICard label="Разходи стоки" value={`${(kpis.costs || 0).toLocaleString('bg-BG', {minimumFractionDigits: 0})} BGN`}
          sub="входящи доставки" color="red" icon={<TrendingDown size={16} />} />
        <KPICard label="Брутен марж" value={`${margin}%`}
          sub={`~${((kpis.revenue - kpis.costs) || 0).toLocaleString('bg-BG', {maximumFractionDigits: 0})} BGN`}
          color="blue" icon={<Percent size={16} />} />
        <KPICard label="Склад" value={kpis.inventoryCount || 0}
          sub="артикула налични" color="orange" icon={<Package size={16} />} />
      </div>

      {vat && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="card p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#71717a]">Изходящ ДДС</div>
            <div className="text-xl font-bold text-white mt-2">{vat.outputVat.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN</div>
          </div>
          <div className="card p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#71717a]">Входящ ДДС</div>
            <div className="text-xl font-bold text-white mt-2">{vat.estimatedInputVat.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN</div>
          </div>
          <div className="card p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#71717a]">Нетно ДДС</div>
            <div className={`text-xl font-bold mt-2 ${vat.netVat >= 0 ? 'text-[#ff9f0a]' : 'text-[#30d158]'}`}>
              {vat.netVat.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN
            </div>
            {vat.pendingCredit > 0 && <div className="text-xs text-[#71717a] mt-1">Потенциален кредит: {vat.pendingCredit.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} BGN</div>}
          </div>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2 card p-5">
          <h3 className="font-semibold text-white mb-4">Приходи по месец</h3>
          <RevenueChart data={data?.revenueByMonth || []} />
        </div>
        <div className="card p-5">
          <h3 className="font-semibold text-white mb-4">Топ клиенти</h3>
          <TopClientsChart data={data?.topClients || []} />
        </div>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card overflow-hidden">
          <div className="p-5 border-b border-[#27272a]">
            <h3 className="font-semibold text-white">Последни фактури</h3>
          </div>
          <RecentInvoices invoices={data?.recentInvoices || []} />
        </div>
        <div className="card overflow-hidden">
          <div className="p-5 border-b border-[#27272a]">
            <h3 className="font-semibold text-white">⏳ Неплатени</h3>
          </div>
          <RecentInvoices invoices={data?.pendingInvoices || []} showStatus />
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-6 max-w-7xl mx-auto animate-pulse">
      <div className="h-8 w-48 bg-[#27272a] rounded mb-8" />
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-[#111113] border border-[#27272a] rounded-2xl" />)}
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 h-64 bg-[#111113] border border-[#27272a] rounded-2xl" />
        <div className="h-64 bg-[#111113] border border-[#27272a] rounded-2xl" />
      </div>
    </div>
  );
}
