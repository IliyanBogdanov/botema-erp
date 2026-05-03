'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { KPICard } from '@/components/KPICard';
import { RevenueChart } from '@/components/RevenueChart';
import { TopClientsChart } from '@/components/TopClientsChart';
import { RecentInvoices } from '@/components/RecentInvoices';
import { PendingDocuments } from '@/components/PendingDocuments';
import { useState } from 'react';
import { TrendingUp, TrendingDown, Package, Clock, DollarSign, Percent } from 'lucide-react';

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
