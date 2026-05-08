'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';
import { useT } from '@/lib/i18n';

const BGN_PER_EUR = 1.95583;

function pct(a: number, b: number) {
  if (!b) return '0%';
  return ((a / b) * 100).toFixed(1) + '%';
}

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

function MonthBar({ month, out, inn, max }: { month: string; out: number; inn: number; max: number }) {
  const outH = max > 0 ? Math.max(2, (out / max) * 100) : 2;
  const innH = max > 0 ? Math.max(2, (inn / max) * 100) : 2;
  return (
    <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
      <div className="w-full flex items-end gap-0.5 h-24">
        <div className="flex-1 rounded-sm bg-primary/60 transition-all" style={{ height: `${outH}%` }} title={`Изходящ: ${fmt(out, 'BGN')}`} />
        <div className="flex-1 rounded-sm bg-primary-container/40 transition-all" style={{ height: `${innH}%` }} title={`Входящ: ${fmt(inn, 'BGN')}`} />
      </div>
      <span className="font-label-caps text-[9px] text-on-surface-variant/60 truncate w-full text-center">{month}</span>
    </div>
  );
}

const MONTH_NAMES_BG = ['Яну', 'Фев', 'Мар', 'Апр', 'Май', 'Юни', 'Юли', 'Авг', 'Сеп', 'Окт', 'Ное', 'Дек'];
const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function VatPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const t = useT();

  const { data, isLoading } = useQuery({
    queryKey: ['vat-detail', year],
    queryFn: () => api.get(`/vat/overview?year=${year}`).then(r => r.data),
  });

  // Fetch monthly data for chart
  const monthlyQueries = Array.from({ length: 12 }, (_, i) => i + 1);
  const { data: monthlyData } = useQuery({
    queryKey: ['vat-monthly', year],
    queryFn: async () => {
      const results = await Promise.all(
        monthlyQueries.map(m => api.get(`/vat/overview?year=${year}&month=${m}`).then(r => r.data).catch(() => null))
      );
      return results;
    },
  });

  const out = Number(data?.outputVat || 0);
  const inn = Number(data?.estimatedInputVat || 0);
  const pending = Number(data?.pendingCredit || 0);
  const net = Number(data?.netVat || 0);
  const afterCredit = Number(data?.afterPendingCredit || 0);
  const counts = data?.counts || {};
  const alerts = data?.alerts || [];

  const monthlyMax = monthlyData
    ? Math.max(...monthlyData.map((m: any) => m ? Math.max(Number(m.outputVat || 0), Number(m.estimatedInputVat || 0)) : 0), 1)
    : 1;

  const langIsBg = t('nav.dashboard') === 'Dashboard' ? false : true;
  const monthNames = langIsBg ? MONTH_NAMES_BG : MONTH_NAMES_EN;

  return (
    <div className="min-h-screen">
      {/* ── HEADER ─────────────────────────────────────────────────────────────── */}
      <div className="border-b border-outline-variant/10 bg-surface-container-lowest sticky top-0 z-10">
        <div className="px-8 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-0.5">ДДС МЕНИДЖМЪНТ</p>
            <h1 className="font-headline text-headline-lg text-on-surface">ДДС Справка</h1>
          </div>
          <div className="flex items-center gap-2">
            {[2024, 2025, 2026].map(y => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`px-4 py-2 font-label-caps text-label-caps transition-colors border ${
                  y === year
                    ? 'bg-primary-container text-on-primary-container border-primary-container'
                    : 'bg-transparent text-on-surface-variant border-outline-variant/20 hover:bg-surface-container-high'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-8 py-6 space-y-6">
        {/* ── SUMMARY CARDS ────────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 bg-surface-container-low border border-outline-variant/10 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <VatMetricCard
              icon="receipt"
              label="ИЗХОДЯЩ ДДС"
              value={fmt(out, 'BGN')}
              sub={`${counts.outgoingInvoices || 0} фактури`}
            />
            <VatMetricCard
              icon="shopping_cart"
              label="ВХОДЯЩ ДДС"
              value={fmt(inn, 'BGN')}
              sub={`${counts.incomingPurchases || 0} покупки`}
            />
            <VatMetricCard
              icon="pending_actions"
              label="ПОТЕНЦИАЛЕН КРЕДИТ"
              value={fmt(pending, 'BGN')}
              sub={`${counts.pendingDocuments || 0} непрегледани документа`}
            />
            <VatMetricCard
              icon={net > 0 ? 'trending_up' : 'trending_down'}
              label="НЕТ ДДС ПОЗИЦИЯ"
              value={fmt(net, 'BGN')}
              sub={afterCredit !== net ? `След кредит: ${fmt(afterCredit, 'BGN')}` : undefined}
              accent
            />
          </div>
        )}

        {/* ── VAT POSITION BAR ─────────────────────────────────────────────────── */}
        {!isLoading && (out > 0 || inn > 0) && (
          <div className="border border-outline-variant/10 bg-surface-container-low p-5">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">ДДС БАЛАНС {year}</p>
            <div className="space-y-3">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-primary/60 inline-block" />
                    Изходящ ДДС (начислен)
                  </span>
                  <span className="font-semibold text-on-surface text-sm">{fmt(out, 'BGN')}</span>
                </div>
                <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                  <div className="h-full bg-primary/60 rounded-full" style={{ width: '100%' }} />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-primary-container/60 inline-block" />
                    Входящ ДДС (приспадан)
                  </span>
                  <span className="font-semibold text-on-surface text-sm">{fmt(inn, 'BGN')} ({pct(inn, out)})</span>
                </div>
                <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                  <div className="h-full bg-primary-container/60 rounded-full" style={{ width: pct(inn, out) }} />
                </div>
              </div>
              {pending > 0 && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-sm bg-warning/40 inline-block" />
                      Потенциален кредит (непрегледани)
                    </span>
                    <span className="font-semibold text-warning text-sm">{fmt(pending, 'BGN')} ({pct(pending, out)})</span>
                  </div>
                  <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                    <div className="h-full bg-warning/40 rounded-full" style={{ width: pct(pending, out) }} />
                  </div>
                </div>
              )}
              <div className="pt-2 border-t border-outline-variant/10 flex items-center justify-between">
                <span className="font-label-caps text-label-caps text-on-surface-variant">ЗА ВНАСЯНЕ / ПРИСПАДАНЕ</span>
                <span className={`font-headline text-headline-sm ${net > 0 ? 'text-error' : 'text-primary'}`}>
                  {net > 0 ? '▲ ' : '▼ '}{fmt(Math.abs(net), 'BGN')}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ── MONTHLY CHART ────────────────────────────────────────────────────── */}
        <div className="border border-outline-variant/10 bg-surface-container-low p-5">
          <div className="flex items-center justify-between mb-4">
            <p className="font-label-caps text-label-caps text-on-surface-variant">МЕСЕЧНА ДИНАМИКА {year}</p>
            <div className="flex items-center gap-3 text-xs text-on-surface-variant/70">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-primary/60 inline-block" />
                Изходящ ДДС
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-primary-container/40 inline-block" />
                Входящ ДДС
              </span>
            </div>
          </div>
          <div className="flex items-end gap-2 h-32">
            {monthNames.map((name, i) => {
              const m = monthlyData?.[i];
              const mOut = Number(m?.outputVat || 0);
              const mIn = Number(m?.estimatedInputVat || 0);
              return <MonthBar key={i} month={name} out={mOut} inn={mIn} max={monthlyMax} />;
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── VAT ALERTS ─────────────────────────────────────────────────────── */}
          <div className="border border-outline-variant/10 bg-surface-container-low p-5">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">
              АКТИВНИ ДДС СИГНАЛИ
              {alerts.length > 0 && (
                <span className="ml-2 bg-error/20 text-error border border-error/30 text-[9px] px-1.5 py-0.5">{alerts.length}</span>
              )}
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
                      <p className="font-body-sm text-body-sm text-on-surface truncate">{alert.title}</p>
                      {alert.description && (
                        <p className="font-body-sm text-body-sm text-on-surface-variant/70 truncate">{alert.description}</p>
                      )}
                    </div>
                    <span className="font-label-caps text-[8px] text-on-surface-variant/50 shrink-0">
                      {fmtDate(alert.detectedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── VAT SUMMARY TABLE ────────────────────────────────────────────────── */}
          <div className="border border-outline-variant/10 bg-surface-container-low p-5">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-4">ОБОБЩЕНА СПРАВКА {year}</p>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-outline-variant/5">
                {[
                  { label: 'Издадени фактури', val: counts.outgoingInvoices || 0, unit: 'бр.' },
                  { label: 'Изходящ ДДС', val: fmt(out, 'BGN'), unit: '' },
                  { label: 'Входящи покупки', val: counts.incomingPurchases || 0, unit: 'бр.' },
                  { label: 'Входящ ДДС (изчислен)', val: fmt(inn, 'BGN'), unit: '' },
                  { label: 'EUR → BGN курс', val: BGN_PER_EUR.toFixed(5), unit: '' },
                  { label: 'Непрегледани документи', val: counts.pendingDocuments || 0, unit: 'бр.', warn: (counts.pendingDocuments || 0) > 5 },
                  { label: 'Нет ДДС позиция', val: fmt(net, 'BGN'), unit: '', bold: true, accent: true },
                  { label: 'След потенциален кредит', val: fmt(afterCredit, 'BGN'), unit: '', bold: true },
                ].map(row => (
                  <tr key={row.label}>
                    <td className="py-2 text-on-surface-variant font-body-sm text-body-sm">{row.label}</td>
                    <td className={`py-2 text-right font-semibold ${row.accent ? 'text-primary' : row.warn ? 'text-warning' : 'text-on-surface'} ${row.bold ? 'text-base' : ''}`}>
                      {row.val}{row.unit ? ' ' + row.unit : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── DISCLAIMER ───────────────────────────────────────────────────────── */}
        <div className="border border-outline-variant/5 bg-surface-container-lowest p-4 flex items-start gap-2">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant/40 mt-0.5">info</span>
          <p className="font-body-sm text-body-sm text-on-surface-variant/60">
            Входящият ДДС е изчислен от парснати фактури и покупки. Непрегледаните документи могат да увеличат входящия кредит.
            Данните са индикативни — за официална справка използвайте счетоводния Ви софтуер.
          </p>
        </div>
      </div>
    </div>
  );
}
