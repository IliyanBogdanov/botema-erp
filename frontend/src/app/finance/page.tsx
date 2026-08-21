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

const CATEGORY_LABELS: Record<string, string> = {
  INCOME: 'Постъпления', PURCHASE: 'Покупки стока', SALARY: 'Заплати', TAX: 'Данъци и мита',
  RENT: 'Наем', BANK_FEE: 'Банкови такси', SOFTWARE_ADS: 'Софтуер и реклама',
  LOGISTICS: 'Логистика', SERVICES: 'Услуги', CASH: 'Кеш', OTHER: 'Друго',
};

export default function FinancePage() {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading, isError } = useQuery({
    queryKey: ['monthly-pnl', year],
    queryFn: () => api.get(`/dashboard/monthly-pnl?year=${year}`).then(r => r.data),
  });

  // Bank truth (leading source): monthly cash flow + category breakdown
  const { data: cashflow } = useQuery({
    queryKey: ['cashflow', year],
    queryFn: () => api.get(`/dashboard/cashflow?year=${year}`).then(r => r.data),
    staleTime: 60000,
  });
  const cfMonths: any[] = cashflow?.months || [];
  const cfTotals = cashflow?.totals || { inEur: 0, outEur: 0, netEur: 0 };
  const cfCats: [string, number][] = Object.entries(cashflow?.byCategory || {})
    .filter(([k]) => k !== 'INCOME')
    .sort((a: any, b: any) => b[1] - a[1]) as [string, number][];
  const cfMaxCat = cfCats.length ? Math.max(...cfCats.map(([, v]) => v)) : 1;

  // Forward-looking 30/60/90-day cash-flow forecast (year-independent)
  const { data: forecast } = useQuery({
    queryKey: ['forecast'],
    queryFn: () => api.get('/dashboard/forecast').then(r => r.data),
    staleTime: 60000,
  });
  const FORECAST_BUCKETS: { key: string; label: string }[] = [
    { key: 'OVERDUE', label: 'ПРОСРОЧЕНО' },
    { key: 'D0_30', label: '0–30 ДНИ' },
    { key: 'D31_60', label: '31–60 ДНИ' },
    { key: 'D61_90', label: '61–90 ДНИ' },
    { key: 'D90_PLUS', label: '90+ ДНИ' },
  ];

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
            {[new Date().getFullYear() - 2, new Date().getFullYear() - 1, new Date().getFullYear()].map(y => (
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
        {/* ── ПАРИЧЕН ПОТОК (ПО БАНКА) — водещият източник ── */}
        <div className="border border-primary-container/20 bg-surface-container-low overflow-hidden">
          <div className="px-5 py-3 border-b border-outline-variant/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary">account_balance</span>
              <p className="font-label-caps text-label-caps text-on-surface">ПАРИЧЕН ПОТОК ПО БАНКА — {year}</p>
            </div>
            <p className="font-label-caps text-[9px] text-on-surface-variant/50">ВОДЕЩ ИЗТОЧНИК · РЕАЛНИ ДВИЖЕНИЯ ПО СМЕТКАТА</p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-outline-variant/10">
            <div className="p-5">
              <p className="font-label-caps text-[9px] text-on-surface-variant mb-2">ПОСТЪПЛЕНИЯ</p>
              <p className="font-headline text-headline-md text-emerald-400">{fmt(cfTotals.inEur)}</p>
            </div>
            <div className="p-5">
              <p className="font-label-caps text-[9px] text-on-surface-variant mb-2">ИЗХОДЯЩИ</p>
              <p className="font-headline text-headline-md text-error/80">{fmt(cfTotals.outEur)}</p>
            </div>
            <div className="p-5">
              <p className="font-label-caps text-[9px] text-on-surface-variant mb-2">НЕТЕН ПОТОК</p>
              <p className={`font-headline text-headline-md ${cfTotals.netEur >= 0 ? 'text-emerald-400' : 'text-error'}`}>
                {cfTotals.netEur >= 0 ? '+' : ''}{fmt(cfTotals.netEur)}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 border-t border-outline-variant/10">
            {/* Месечен поток */}
            <div className="p-5">
              <p className="font-label-caps text-[9px] text-on-surface-variant/60 mb-3">ПО МЕСЕЦИ (EUR)</p>
              <div className="flex items-end gap-1.5 h-24">
                {cfMonths.map((m, i) => {
                  const max = Math.max(...cfMonths.map(x => Math.max(x.inEur, x.outEur)), 1);
                  return (
                    <div key={i} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                      <div className="w-full flex items-end gap-0.5 h-20">
                        <MiniBar value={m.inEur} max={max} color="bg-emerald-400/60" />
                        <MiniBar value={m.outEur} max={max} color="bg-error/40" />
                      </div>
                      <span className="font-label-caps text-[8px] text-on-surface-variant/50">{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Разбивка по категории */}
            <div className="p-5 lg:border-l border-outline-variant/10">
              <p className="font-label-caps text-[9px] text-on-surface-variant/60 mb-3">ИЗХОДЯЩИ ПО КАТЕГОРИИ (EUR)</p>
              <div className="space-y-1.5">
                {cfCats.slice(0, 6).map(([cat, v]) => (
                  <div key={cat} className="flex items-center gap-2">
                    <span className="font-label-caps text-[9px] text-on-surface-variant w-32 shrink-0">{CATEGORY_LABELS[cat] || cat}</span>
                    <div className="flex-1 h-2 bg-surface-container-high overflow-hidden rounded-sm">
                      <div className="h-full bg-primary-container/60 rounded-sm" style={{ width: `${Math.round((v / cfMaxCat) * 100)}%` }} />
                    </div>
                    <span className="font-data-mono text-[10px] text-on-surface w-20 text-right shrink-0">{Math.round(v).toLocaleString('bg-BG')}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── ПРОГНОЗА ЗА ПАРИЧНИЯ ПОТОК 30/60/90 ДНИ ── */}
        <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
          <div className="px-5 py-3 border-b border-outline-variant/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary">schedule</span>
              <p className="font-label-caps text-label-caps text-on-surface">ПРОГНОЗА ЗА ПАРИЧНИЯ ПОТОК</p>
            </div>
            <p className="font-label-caps text-[9px] text-on-surface-variant/50">НЕПЛАТЕНИ ФАКТУРИ И РАЗХОДИ ПО СРОК</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-outline-variant/10">
                  <th className="table-header text-left w-36"> </th>
                  {FORECAST_BUCKETS.map(b => <th key={b.key} className="table-header text-right">{b.label}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-outline-variant/5">
                  <td className="table-cell font-medium text-emerald-400">Очаквани постъпления</td>
                  {FORECAST_BUCKETS.map(b => (
                    <td key={b.key} className="table-cell text-right font-data-mono text-on-surface">
                      {fmt(forecast?.inflows?.buckets?.[b.key] || 0)}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-outline-variant/5">
                  <td className="table-cell font-medium text-error/80">Очаквани плащания</td>
                  {FORECAST_BUCKETS.map(b => (
                    <td key={b.key} className="table-cell text-right font-data-mono text-error/80">
                      {fmt(forecast?.outflows?.buckets?.[b.key] || 0)}
                    </td>
                  ))}
                </tr>
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-outline-variant/20 bg-surface-container">
                  <td className="table-cell font-semibold text-on-surface">Нетно</td>
                  {FORECAST_BUCKETS.map(b => {
                    const v = forecast?.net?.[b.key] || 0;
                    return (
                      <td key={b.key} className={`table-cell text-right font-semibold font-data-mono ${v >= 0 ? 'text-emerald-400' : 'text-error'}`}>
                        {v >= 0 ? '+' : ''}{fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="px-5 py-2.5 border-t border-outline-variant/10">
            <p className="font-label-caps text-[9px] text-on-surface-variant/50">
              Базирано на срокове за плащане на неплатени фактури (приходи) и документирани разходи без банково потвърдено плащане. Записи без падеж се оценяват на +30 дни от датата на документа.
            </p>
          </div>
        </div>

        <p className="font-label-caps text-[9px] text-on-surface-variant/40 tracking-[0.1em] pt-2">ДОКУМЕНТЕН ИЗГЛЕД (ФАКТУРИ) — СПОМАГАТЕЛЕН, ОФИЦИАЛНИТЕ ЧИСЛА СА В MICRO.BG</p>
        {/* Annual KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {isLoading ? (
            [...Array(4)].map((_, i) => <div key={i} className="h-28 bg-surface-container-low border border-outline-variant/10 animate-pulse" />)
          ) : isError ? (
            <div className="col-span-4 p-6 text-center text-on-surface-variant font-body-sm">Грешка при зареждане на данните. Опитайте отново.</div>
          ) : (
            <>
              <KpiCard icon="trending_up" label={`ПРИХОДИ ${year === new Date().getFullYear() ? 'ЯНУ–' + MONTH_SHORT[new Date().getMonth()] + ' ' + year : year}`} value={fmt(totals.revenue)} sub={`Нет от ${year} г.`} />
              <KpiCard icon="shopping_cart" label={`РАЗХОДИ ${year === new Date().getFullYear() ? 'ЯНУ–' + MONTH_SHORT[new Date().getMonth()] + ' ' + year : year}`} value={fmt(totals.costs)} sub={`Покупки за ${year} г. (вкл. авансови)`} />
              <KpiCard icon="savings" label={`БРУТНА ПЕЧАЛБА ${year}`} value={fmt(totals.profit)}
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
                              : <span className="font-data-mono text-data-mono text-on-surface">{fmt(m.revenue)}</span>}
                          </td>
                          <td className="table-cell text-right">
                            {isEmpty ? <span className="text-on-surface-variant/30">—</span>
                              : <span className="font-data-mono text-data-mono text-error/80">{fmt(m.costs)}</span>}
                          </td>
                          <td className="table-cell text-right">
                            {isEmpty ? <span className="text-on-surface-variant/30">—</span>
                              : <span className={`font-data-mono text-data-mono font-semibold ${m.profit >= 0 ? 'text-emerald-400' : 'text-error'}`}>
                                  {m.profit >= 0 ? '+' : ''}{fmt(m.profit)}
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
                    <td className="table-cell text-right font-semibold font-data-mono text-on-surface">{fmt(totals.revenue)}</td>
                    <td className="table-cell text-right font-semibold font-data-mono text-error/80">{fmt(totals.costs)}</td>
                    <td className="table-cell text-right font-semibold font-data-mono">
                      <span className={totals.profit >= 0 ? 'text-emerald-400' : 'text-error'}>
                        {totals.profit >= 0 ? '+' : ''}{fmt(totals.profit)}
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
            Приходите са от издадени фактури (без отменени и архивирани). Разходите са от всички регистрирани покупки за периода.
            Данните са ориентировъчни и не заместват счетоводен отчет.
          </p>
        </div>
      </div>
    </div>
  );
}


