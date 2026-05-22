'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, fmtBgn } from '@/lib/api';

const BGN_PER_EUR = 1.95583;

function VatMetricCard({
  label, value, sub, accent = false, icon,
}: { label: string; value: string; sub?: string; accent?: boolean; icon: string }) {
  return (
    <div className={`border p-5 flex flex-col gap-3 ${accent
      ? 'border-primary-container/40 bg-primary-container/5'
      : 'border-outline-variant/10 bg-surface-container-low'}`}>
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>
        <p className="font-label-caps text-label-caps text-on-surface-variant">{label}</p>
      </div>
      <p className={`font-headline text-headline-md ${accent ? 'text-primary' : 'text-on-surface'}`}>{value}</p>
      {sub && <p className="font-body-sm text-body-sm text-on-surface-variant">{sub}</p>}
    </div>
  );
}

const MONTH_NAMES = ['Януари', 'Февруари', 'Март', 'Април', 'Май', 'Юни', 'Юли', 'Август', 'Септември', 'Октомври', 'Ноември', 'Декември'];
const MONTH_SHORT = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];

function MonthBar({ month, out, inn, max }: { month: string; out: number; inn: number; max: number }) {
  const outH = max > 0 ? Math.max(2, (out / max) * 100) : 2;
  const innH = max > 0 ? Math.max(2, (inn / max) * 100) : 2;
  return (
    <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
      <div className="w-full flex items-end gap-0.5 h-24">
        <div className="flex-1 rounded-sm bg-primary/60 transition-all" style={{ height: `${outH}%` }} title={`Изходящ: ${fmtBgn(out)}`} />
        <div className="flex-1 rounded-sm bg-primary-container/40 transition-all" style={{ height: `${innH}%` }} title={`Входящ: ${fmtBgn(inn)}`} />
      </div>
      <span className="font-label-caps text-[9px] text-on-surface-variant/60 truncate w-full text-center">{month}</span>
    </div>
  );
}

export default function VatPage() {
  const [year, setYear] = useState(new Date().getFullYear());

  const { data, isLoading } = useQuery({
    queryKey: ['vat-detail', year],
    queryFn: () => api.get(`/vat/overview?year=${year}`).then(r => r.data),
  });

  const { data: breakdown } = useQuery({
    queryKey: ['vat-monthly-breakdown', year],
    queryFn: () => api.get(`/vat/monthly-breakdown?year=${year}`).then(r => r.data),
  });

  const out = Number(data?.outputVat || 0);
  const inn = Number(data?.estimatedInputVat || 0);
  const pending = Number(data?.pendingCredit || 0);
  const net = Number(data?.netVat || 0);
  const afterCredit = Number(data?.afterPendingCredit || 0);
  const counts = data?.counts || {};
  const alerts = data?.alerts || [];

  const months: any[] = breakdown?.months || [];
  const monthlyMax = months.length
    ? Math.max(...months.map(m => Math.max(m.outputVat, m.inputVat)), 1)
    : 1;
  const currentMonth = new Date().getMonth();

  return (
    <div className="min-h-screen">
      <div className="border-b border-outline-variant/10 bg-surface-container-lowest sticky top-0 z-10">
        <div className="px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-0.5">ДДС МЕНИДЖМЪНТ</p>
            <h1 className="font-headline text-headline-lg text-on-surface">ДДС Справка — {year}</h1>
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
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 bg-surface-container-low border border-outline-variant/10 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <VatMetricCard icon="receipt" label="ИЗХОДЯЩ ДДС" value={fmtBgn(out)} sub={`${counts.outgoingInvoices || 0} фактури за ${year} г.`} />
            <VatMetricCard icon="shopping_cart" label="ВХОДЯЩ ДДС" value={fmtBgn(inn)} sub={`${counts.incomingPurchases || 0} покупки за ${year} г.`} />
            <VatMetricCard icon="pending_actions" label="ПОТЕНЦИАЛЕН КРЕДИТ" value={fmtBgn(pending)} sub={`${counts.pendingDocuments || 0} непрегледани`} />
            <VatMetricCard icon={net > 0 ? 'trending_up' : 'trending_down'} label="НЕТ ДДС ПОЗИЦИЯ" value={fmtBgn(net)} sub={afterCredit !== net ? `След кредит: ${fmtBgn(afterCredit)}` : `За ${year} г.`} accent />
          </div>
        )}

        {/* Monthly breakdown table */}
        <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden">
          <div className="px-5 py-3 border-b border-outline-variant/10 flex items-center justify-between">
            <p className="font-label-caps text-label-caps text-on-surface-variant">МЕСЕЧНА ДДС СПРАВКА — {year}</p>
            <div className="flex items-center gap-4 text-[10px] text-on-surface-variant/60">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-primary/60 inline-block" /> Изходящ</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-primary-container/50 inline-block" /> Входящ</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-outline-variant/10">
                  <th className="table-header text-left w-36">МЕСЕЦ</th>
                  <th className="table-header text-right">ИЗХОДЯЩ ДДС</th>
                  <th className="table-header text-right">ВХОДЯЩ ДДС</th>
                  <th className="table-header text-right">НЕТ</th>
                  <th className="table-header text-right">СТАТУС</th>
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
                      const isEmpty = m.outputVat === 0 && m.inputVat === 0;
                      const isCurrent = i === currentMonth && year === new Date().getFullYear();
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
                              : <span className="font-data-mono text-data-mono text-on-surface">{fmtBgn(m.outputVat)}</span>}
                          </td>
                          <td className="table-cell text-right">
                            {isEmpty ? <span className="text-on-surface-variant/30">—</span>
                              : <span className="font-data-mono text-data-mono text-primary">{fmtBgn(m.inputVat)}</span>}
                          </td>
                          <td className="table-cell text-right">
                            {isEmpty ? <span className="text-on-surface-variant/30">—</span>
                              : <span className={`font-data-mono text-data-mono font-semibold ${m.netVat > 0 ? 'text-error' : 'text-emerald-400'}`}>
                                  {m.netVat > 0 ? '+' : ''}{fmtBgn(m.netVat)}
                                </span>}
                          </td>
                          <td className="table-cell text-right">
                            {!isEmpty && (m.netVat > 0
                              ? <span className="px-2 py-0.5 border border-error/30 bg-error/10 font-label-caps text-[9px] text-error">за внасяне</span>
                              : <span className="px-2 py-0.5 border border-emerald-400/30 bg-emerald-400/10 font-label-caps text-[9px] text-emerald-400">кредит</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
              {months.length > 0 && (() => {
                const totOut = months.reduce((s, m) => s + m.outputVat, 0);
                const totIn  = months.reduce((s, m) => s + m.inputVat, 0);
                const totNet = months.reduce((s, m) => s + m.netVat, 0);
                return (
                  <tfoot>
                    <tr className="border-t-2 border-outline-variant/20 bg-surface-container">
                      <td className="table-cell font-semibold text-on-surface">ОБЩО {year}</td>
                      <td className="table-cell text-right font-semibold font-data-mono text-on-surface">{fmtBgn(totOut)}</td>
                      <td className="table-cell text-right font-semibold font-data-mono text-primary">{fmtBgn(totIn)}</td>
                      <td className="table-cell text-right font-semibold font-data-mono">
                        <span className={totNet > 0 ? 'text-error' : 'text-emerald-400'}>{totNet > 0 ? '+' : ''}{fmtBgn(totNet)}</span>
                      </td>
                      <td className="table-cell" />
                    </tr>
                  </tfoot>
                );
              })()}
            </table>
          </div>
        </div>

        {/* Bar chart */}
        <div className="border border-outline-variant/10 bg-surface-container-low p-5">
          <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">ВИЗУАЛНА ДИНАМИКА — {year}</p>
          <div className="flex items-end gap-2 h-32">
            {(months.length > 0 ? months : Array(12).fill({ outputVat: 0, inputVat: 0 })).map((m, i) => (
              <MonthBar key={i} month={MONTH_SHORT[i]} out={m.outputVat} inn={m.inputVat} max={monthlyMax} />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Alerts */}
          <div className="border border-outline-variant/10 bg-surface-container-low p-5">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">
              АКТИВНИ ДДС СИГНАЛИ
              {alerts.length > 0 && <span className="ml-2 bg-error/20 text-error border border-error/30 text-[9px] px-1.5 py-0.5">{alerts.length}</span>}
            </p>
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-primary py-4">
                <span className="material-symbols-outlined text-[20px]">check_circle</span>
                <span className="font-body-sm text-body-sm">Няма активни ДДС сигнали</span>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.slice(0, 8).map((alert: any) => (
                  <div key={alert.id} className="flex items-start gap-2.5 py-2 border-b border-outline-variant/5 last:border-0">
                    <span className="material-symbols-outlined text-[16px] text-warning mt-0.5">warning</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-body-sm text-body-sm text-on-surface">{alert.title}</p>
                      {alert.description && <p className="font-body-sm text-body-sm text-on-surface-variant/70">{alert.description}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Annual summary */}
          <div className="border border-outline-variant/10 bg-surface-container-low p-5">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">ГОДИШНО ОБОБЩЕНИЕ — {year}</p>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-outline-variant/5">
                {[
                  { label: 'Издадени фактури', val: `${counts.outgoingInvoices || 0} бр.` },
                  { label: `Изходящ ДДС (${year})`, val: fmtBgn(out) },
                  { label: 'Входящи покупки', val: `${counts.incomingPurchases || 0} бр.` },
                  { label: `Входящ ДДС (${year})`, val: fmtBgn(inn) },
                  { label: 'BGN/EUR курс fixe', val: BGN_PER_EUR.toFixed(5) },
                  { label: `Нет ДДС позиция (${year})`, val: fmtBgn(net), accent: true, bold: true },
                  { label: 'След потенциален кредит', val: fmtBgn(afterCredit), bold: true },
                ].map(row => (
                  <tr key={row.label}>
                    <td className="py-2.5 text-on-surface-variant font-body-sm text-body-sm">{row.label}</td>
                    <td className={`py-2.5 text-right font-semibold ${(row as any).accent ? 'text-primary' : 'text-on-surface'}`}>
                      {row.val}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="border border-outline-variant/5 bg-surface-container-lowest p-4 flex items-start gap-2">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant/40 mt-0.5">info</span>
          <p className="font-body-sm text-body-sm text-on-surface-variant/60">
            Входящият ДДС е изчислен от парснати фактури и покупки. Данните са индикативни — за официална справка използвайте счетоводния Ви софтуер.
          </p>
        </div>
      </div>
    </div>
  );
}

