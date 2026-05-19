'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, fmtBgn } from '@/lib/api';

const MONTH_NAMES = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const MONTH_SHORT = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];

function KpiCard({ label, value, sub, icon, positive }: { label: string; value: string; sub?: string; icon: string; positive?: boolean }) {
  return (
    <div className="border border-outline-variant/10 bg-surface-container-low p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>
        <p className="font-label-caps text-label-caps text-on-surface-variant">{label}</p>
      </div>
      <p className={`font-headline text-headline-md ${positive === undefined ? 'text-on-surface' : positive ? 'text-emerald-400' : 'text-error'}`}>{value}</p>
      {sub && <p className="font-body-sm text-body-sm text-on-surface-variant">{sub}</p>}
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const h = max > 0 ? Math.max(2, (value / max) * 100) : 2;
  return <div className={`flex-1 rounded-sm ${color} transition-all`} style={{ height: `${h}%` }} />;
}

export default function FinancePage() {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading, isError } = useQuery({
    queryKey: ['monthly-pnl', year],
    queryFn: () => api.get(`/dashboard/monthly-pnl?year=${year}`).then(r => r.data),
  });

  const months: any[] = data?.months || [];
  const totals = data?.totals || { revenue: 0, costs: 0, profit: 0, margin: 0 };
  const currentMonth = new Date().getMonth();

  const maxRevenue = months.length ? Math.max(...months.map(m => m.revenue), 1) : 1;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-outline-variant/10 bg-surface-container-lowest sticky top-0 z-10">
        <div className="px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-0.5">ФИНАНСОВ АНАЛИЗ</p>
            <h1 className="font-headline text-headline-lg text-on-surface">Приходи & Разходи — {year}</h1>
          </div>
          <div className="flex items-center gap-2">
            {[2024, 2025, 2026].map(y => (
              <button key={y} onClick={() => setYear(y)}
                className={`px-4 py-2 font-label-caps text-label-caps transition-colors border ${y === year
                  ? 'bg-primary-container text-on-primary-container border-primary-container'
                  : 'bg-transparent text-on-surface-variant border-outline-variant/20 hover:bg-surface-container-high'}`}>
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* YTD disclaimer for current year */}
        {year === new Date().getFullYear() && (
          <div className="border border-outline-variant/10 border-l-4 border-l-primary-container/40 bg-surface-container-low px-4 py-2.5 flex items-center gap-3">
            <span className="material-symbols-outlined text-[16px] text-primary/50">info</span>
            <p className="font-label-caps text-[10px] text-on-surface-variant/60 tracking-[0.1em]">
              ДАННИТЕ СА ЯНУ–{MONTH_SHORT[new Date().getMonth()]} {year} (YTD) — РАЗХОДИТЕ ВКЛЮЧВАТ АВАНСОВИ ПОКУПКИ ЗА БЪДЕЩИ ПРОЕКТИ, КОЕТО ВРЕМЕННО ЗАНИЖАВА МАРЖА
            </p>
          </div>
        )}
        {/* Annual KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {isLoading ? (
            [...Array(4)].map((_, i) => <div key={i} className="h-28 bg-surface-container-low border border-outline-variant/10 animate-pulse" />)
          ) : isError ? (
            <div className="col-span-4 p-6 text-center text-on-surface-variant font-body-sm">Грешка при зареждане на данните. Опитайте отново.</div>
          ) : (
            <>
              <KpiCard icon="trending_up" label={`ПРИХОДИ ${year === new Date().getFullYear() ? 'ЯНУ–' + MONTH_SHORT[new Date().getMonth()] + ' ' + year : year}`} value={fmtBgn(totals.revenue)} sub={`Нет от ${year} г.`} />
              <KpiCard icon="shopping_cart" label={`РАЗХОДИ ${year === new Date().getFullYear() ? 'ЯНУ–' + MONTH_SHORT[new Date().getMonth()] + ' ' + year : year}`} value={fmtBgn(totals.costs)} sub={`Покупки за ${year} г. (вкл. авансови)`} />
              <KpiCard icon="savings" label={`БРУТНА ПЕЧАЛБА ${year}`} value={fmtBgn(totals.profit)}
                sub={`Марж ${totals.margin}%`} positive={totals.profit > 0} />
              <KpiCard icon="percent" label="БРУТЕН МАРЖ" value={`${totals.margin}%`} positive={totals.margin > 20} />
            </>
          )}
        </div>

        {/* Monthly breakdown table */}
        <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
          <div className="px-5 py-3 border-b border-outline-variant/10 flex items-center justify-between">
            <p className="font-label-caps text-label-caps text-on-surface-variant">МЕСЕЧЕН П&Л — {year}</p>
            <div className="flex items-center gap-4 text-[10px] text-on-surface-variant/60">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-primary/60 inline-block" /> Приходи</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-error/40 inline-block" /> Разходи</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-400/60 inline-block" /> Печалба</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-outline-variant/10">
                  <th className="table-header text-left w-36">МЕСЕЦ</th>
                  <th className="table-header text-right">ПРИХОДИ (EUR)</th>
                  <th className="table-header text-right">РАЗХОДИ (EUR)</th>
                  <th className="table-header text-right">БРУТНА ПЕЧАЛБА</th>
                  <th className="table-header text-right">МАРЖ</th>
                </tr>
              </thead>
              <tbody>
                {months.length === 0
                  ? [...Array(12)].map((_, i) => (
                      <tr key={i} className="border-b border-outline-variant/5 animate-pulse">
                        <td className="table-cell"><div className="h-3 w-20 bg-surface-container-high rounded" /></td>
                        {[...Array(4)].map((_, j) => <td key={j} className="table-cell"><div className="h-3 w-24 bg-surface-container-high rounded ml-auto" /></td>)}
                      </tr>
                    ))
                  : months.map((m, i) => {
                      const isFuture = year === new Date().getFullYear() && i > currentMonth;
                      const isCurrent = i === currentMonth && year === new Date().getFullYear();
                      const isEmpty = m.revenue === 0 && m.costs === 0;
                      return (
                        <tr key={i} className={`border-b border-outline-variant/5 transition-colors ${isFuture ? 'opacity-25' : 'hover:bg-surface-container-high'} ${isCurrent ? 'bg-primary/5' : ''}`}>
                          <td className="table-cell font-medium text-on-surface">
                            <span className="flex items-center gap-2">
                              {MONTH_NAMES[i]}
                              {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />}
                            </span>
                          </td>
                          <td className="table-cell text-right">
                            {isEmpty ? <span className="text-on-surface-variant/30">—</span>
                              : <span className="font-data-mono text-data-mono text-on-surface">{fmtBgn(m.revenue)}</span>}
                          </td>
                          <td className="table-cell text-right">
                            {isEmpty ? <span className="text-on-surface-variant/30">—</span>
                              : <span className="font-data-mono text-data-mono text-error/80">{fmtBgn(m.costs)}</span>}
                          </td>
                          <td className="table-cell text-right">
                            {isEmpty ? <span className="text-on-surface-variant/30">—</span>
                              : <span className={`font-data-mono text-data-mono font-semibold ${m.profit >= 0 ? 'text-emerald-400' : 'text-error'}`}>
                                  {m.profit >= 0 ? '+' : ''}{fmtBgn(m.profit)}
                                </span>}
                          </td>
                          <td className="table-cell text-right">
                            {isEmpty ? <span className="text-on-surface-variant/30">—</span>
                              : <span className={`font-label-caps text-label-caps ${m.margin >= 20 ? 'text-emerald-400' : m.margin >= 0 ? 'text-warning' : 'text-error'}`}>
                                  {m.margin}%
                                </span>}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
              {months.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-outline-variant/20 bg-surface-container">
                    <td className="table-cell font-semibold text-on-surface">ОБЩО {year}</td>
                    <td className="table-cell text-right font-semibold font-data-mono text-on-surface">{fmtBgn(totals.revenue)}</td>
                    <td className="table-cell text-right font-semibold font-data-mono text-error/80">{fmtBgn(totals.costs)}</td>
                    <td className="table-cell text-right font-semibold font-data-mono">
                      <span className={totals.profit >= 0 ? 'text-emerald-400' : 'text-error'}>
                        {totals.profit >= 0 ? '+' : ''}{fmtBgn(totals.profit)}
                      </span>
                    </td>
                    <td className="table-cell text-right font-semibold">
                      <span className={`font-label-caps ${totals.margin >= 20 ? 'text-emerald-400' : 'text-warning'}`}>{totals.margin}%</span>
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Revenue bar chart */}
        <div className="border border-outline-variant/10 bg-surface-container-low p-5">
          <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">ПРИХОДИ ПО МЕСЕЦИ — {year}</p>
          <div className="flex items-end gap-2 h-32">
            {(months.length > 0 ? months : Array(12).fill({ revenue: 0, costs: 0, profit: 0 })).map((m, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                <div className="w-full flex items-end gap-0.5 h-28">
                  <MiniBar value={m.revenue} max={maxRevenue} color="bg-primary/60" />
                  <MiniBar value={m.costs} max={maxRevenue} color="bg-error/40" />
                  {m.profit > 0 && <MiniBar value={m.profit} max={maxRevenue} color="bg-emerald-400/60" />}
                </div>
                <span className="font-label-caps text-[9px] text-on-surface-variant/60 truncate w-full text-center">{MONTH_SHORT[i]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="border border-outline-variant/5 bg-surface-container-lowest p-4 flex items-start gap-2">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant/40 mt-0.5">info</span>
          <p className="font-body-sm text-body-sm text-on-surface-variant/60">
            Приходите са от издадени фактури (без отменени). Разходите са от всички регистрирани покупки за периода.
            Данните са ориентировъчни и не заместват счетоводен отчет.
          </p>
        </div>
      </div>
    </div>
  );
}


