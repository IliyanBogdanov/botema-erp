'use client';
import { useQuery } from '@tanstack/react-query';
import * as Tabs from '@radix-ui/react-tabs';
import { useParams, useRouter } from 'next/navigation';
import { api, fmt, fmtDate } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';
import { KPICard } from '@/components/KPICard';
import { ArrowLeft, TrendingUp, TrendingDown, DollarSign, FileText } from 'lucide-react';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.get(`/projects/${id}`).then(r => r.data),
    enabled: !!id,
  });

  if (isLoading) return <LoadingSkeleton />;
  if (!data) return (
    <div className="p-6">
      <p className="text-[#ff453a]">Проектът не е намерен.</p>
    </div>
  );

  const project = data;
  const revenue = project.revenue || 0;
  const costs = project.costs || 0;
  const margin = revenue - costs;
  const invoices = project.invoices || [];
  const purchases = project.purchases || [];
  const inventory = project.inventory || [];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 rounded-xl bg-[#1d1d1f] hover:bg-[#27272a] transition-colors text-[#71717a] hover:text-white"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-lg font-bold text-[#0a84ff]">{project.code}</span>
              <StatusBadge status={project.status} />
            </div>
            <h1 className="text-xl font-bold text-white mt-0.5">{project.name}</h1>
            {project.client && (
              <p className="text-sm text-[#71717a] mt-0.5">{project.client.name}</p>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard
          label="Приходи"
          value={`${revenue.toLocaleString('bg-BG', { minimumFractionDigits: 0 })} BGN`}
          sub={`${invoices.length} фактури`}
          color="green"
          icon={<TrendingUp size={16} />}
        />
        <KPICard
          label="Разходи"
          value={`${costs.toLocaleString('bg-BG', { minimumFractionDigits: 0 })} BGN`}
          sub="доставки"
          color="red"
          icon={<TrendingDown size={16} />}
        />
        <KPICard
          label="Марж"
          value={`${margin.toLocaleString('bg-BG', { minimumFractionDigits: 0 })} BGN`}
          sub={revenue ? `${(((margin) / revenue) * 100).toFixed(1)}%` : '0%'}
          color="blue"
          icon={<DollarSign size={16} />}
        />
        <KPICard
          label="Фактури"
          value={invoices.length}
          sub="издадени"
          color="orange"
          icon={<FileText size={16} />}
        />
      </div>

      {/* Tabs */}
      <Tabs.Root defaultValue="invoices">
        <Tabs.List className="flex gap-1 bg-[#1d1d1f] p-1 rounded-xl mb-4 w-fit">
          {[
            { value: 'invoices', label: 'Фактури' },
            { value: 'purchases', label: 'Доставки' },
            { value: 'inventory', label: 'Склад' },
          ].map(tab => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all
                text-[#71717a] data-[state=active]:bg-[#0a84ff] data-[state=active]:text-white"
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* Invoices Tab */}
        <Tabs.Content value="invoices">
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">№</th>
                  <th className="table-header">Дата</th>
                  <th className="table-header">Клиент</th>
                  <th className="table-header text-right">Нето</th>
                  <th className="table-header text-right">Общо</th>
                  <th className="table-header">Статус</th>
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr><td colSpan={6} className="table-cell text-center text-[#52525b] py-8">Няма фактури</td></tr>
                ) : invoices.map((inv: any) => (
                  <tr key={inv.id} className="hover:bg-[#1d1d1f] transition-colors">
                    <td className="table-cell font-mono text-xs text-[#a1a1aa]">{inv.number}</td>
                    <td className="table-cell text-[#a1a1aa]">{fmtDate(inv.date)}</td>
                    <td className="table-cell font-medium text-white">{inv.client?.name || '—'}</td>
                    <td className="table-cell text-right">{fmt(inv.amountNet, inv.currency)}</td>
                    <td className="table-cell text-right font-bold text-white">{fmt(inv.amountTotal, inv.currency)}</td>
                    <td className="table-cell"><StatusBadge status={inv.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        {/* Purchases Tab */}
        <Tabs.Content value="purchases">
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Дата</th>
                  <th className="table-header">Доставчик</th>
                  <th className="table-header">Фактура №</th>
                  <th className="table-header text-right">Сума</th>
                  <th className="table-header">Описание</th>
                </tr>
              </thead>
              <tbody>
                {purchases.length === 0 ? (
                  <tr><td colSpan={5} className="table-cell text-center text-[#52525b] py-8">Няма доставки</td></tr>
                ) : purchases.map((p: any) => (
                  <tr key={p.id} className="hover:bg-[#1d1d1f] transition-colors">
                    <td className="table-cell text-[#a1a1aa]">{fmtDate(p.date)}</td>
                    <td className="table-cell text-white">{p.supplier?.name || '—'}</td>
                    <td className="table-cell font-mono text-xs text-[#a1a1aa]">{p.invoiceNo || '—'}</td>
                    <td className="table-cell text-right font-semibold text-white">{fmt(p.amount, p.currency)}</td>
                    <td className="table-cell text-[#71717a] truncate max-w-[200px]">{p.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tabs.Content>

        {/* Inventory Tab */}
        <Tabs.Content value="inventory">
          <div className="card overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Код</th>
                  <th className="table-header">Артикул</th>
                  <th className="table-header">Категория</th>
                  <th className="table-header text-right">Постъпило</th>
                  <th className="table-header text-right">Изписано</th>
                  <th className="table-header text-right">Налично</th>
                </tr>
              </thead>
              <tbody>
                {inventory.length === 0 ? (
                  <tr><td colSpan={6} className="table-cell text-center text-[#52525b] py-8">Няма артикули</td></tr>
                ) : inventory.map((item: any) => (
                  <tr key={item.id} className="hover:bg-[#1d1d1f] transition-colors">
                    <td className="table-cell font-mono text-xs text-[#a1a1aa]">{item.code}</td>
                    <td className="table-cell font-medium text-white">{item.name}</td>
                    <td className="table-cell text-[#71717a] text-xs">{item.category}</td>
                    <td className="table-cell text-right text-[#30d158]">{item.qtyIn ?? '—'}</td>
                    <td className="table-cell text-right text-[#ff453a]">{item.qtyOut ?? '—'}</td>
                    <td className="table-cell text-right font-bold text-white">{item.qtyBalance ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="p-6 max-w-7xl mx-auto animate-pulse">
      <div className="h-8 w-64 bg-[#27272a] rounded mb-6" />
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-[#111113] border border-[#27272a] rounded-2xl" />)}
      </div>
      <div className="h-64 bg-[#111113] border border-[#27272a] rounded-2xl" />
    </div>
  );
}
