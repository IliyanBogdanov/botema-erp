'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtDate } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';

const BGN_PER_EUR = 1.95583;
const toBgn = (amount: number, currency: string) =>
  currency === 'EUR' ? amount * BGN_PER_EUR : amount;

const STATUS_OPTIONS = ['PENDING', 'PAID'];

export default function PurchaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [showPdf, setShowPdf] = useState(false);
  const [editStatus, setEditStatus] = useState('');
  const [saved, setSaved] = useState('');

  const { data: purchase, isLoading } = useQuery({
    queryKey: ['purchase', id],
    queryFn: () => api.get(`/purchases/${id}`).then(r => r.data),
  });

  const patch = useMutation({
    mutationFn: (data: any) => api.patch(`/purchases/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase', id] });
      qc.invalidateQueries({ queryKey: ['purchases'] });
      setSaved('Запазено ✓');
      setTimeout(() => setSaved(''), 2000);
    },
  });

  if (isLoading) return <div className="p-8 text-on-surface-variant">Зареждане…</div>;
  if (!purchase) return <div className="p-8 text-error">Доставката не е намерена.</div>;

  const total = Number(purchase.amount);
  const totalBgn = toBgn(total, purchase.currency);

  const driveViewUrl = purchase.driveFileId
    ? `https://drive.google.com/file/d/${purchase.driveFileId}/preview`
    : null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-surface-variant transition-colors">
          <span className="material-symbols-outlined text-on-surface-variant">arrow_back</span>
        </button>
        <div className="flex-1">
          <h1 className="font-display-sm text-on-surface">
            Доставка {purchase.invoiceNo ? `№ ${purchase.invoiceNo}` : `— ${fmtDate(purchase.date)}`}
          </h1>
          <p className="font-body-sm text-on-surface-variant">
            {purchase.supplier?.name || '—'} · {fmtDate(purchase.date)}
          </p>
        </div>
        <StatusBadge status={purchase.status || 'PENDING'} />
        {purchase.driveFileId && (
          <a
            href={`https://drive.google.com/file/d/${purchase.driveFileId}/view`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-variant hover:bg-surface-variant/80 transition-colors font-label-md text-on-surface-variant"
          >
            <span className="material-symbols-outlined text-[18px]">open_in_new</span>
            Drive
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: purchase info */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl bg-surface-container p-5 space-y-3">
            <h2 className="font-title-md text-on-surface">Детайли</h2>
            <div className="grid grid-cols-2 gap-4 font-body-sm">
              <div>
                <span className="text-on-surface-variant">Доставчик</span>
                <p className="text-on-surface font-medium">{purchase.supplier?.name || '—'}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Проект</span>
                <p className="text-on-surface font-medium">
                  {purchase.project ? `${purchase.project.code} – ${purchase.project.name}` : '—'}
                </p>
              </div>
              <div>
                <span className="text-on-surface-variant">Дата</span>
                <p className="text-on-surface">{fmtDate(purchase.date)}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Фактура №</span>
                <p className="text-on-surface">{purchase.invoiceNo || '—'}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Валута</span>
                <p className="text-on-surface">{purchase.currency}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Година</span>
                <p className="text-on-surface">{purchase.year}</p>
              </div>
            </div>
            {purchase.description && (
              <p className="font-body-sm text-on-surface-variant border-t border-outline-variant pt-3">
                {purchase.description}
              </p>
            )}
          </div>

          {/* Totals */}
          <div className="rounded-2xl bg-surface-container overflow-hidden">
            <table className="w-full font-body-sm">
              <tfoot>
                <tr className="bg-primary/10">
                  <td className="px-4 py-3 text-right font-title-sm text-on-surface">Сума</td>
                  <td className="px-4 py-3 text-right font-title-sm text-primary">
                    {fmt(total, purchase.currency)}
                    {purchase.currency === 'EUR' && (
                      <span className="text-on-surface-variant font-body-sm ml-2">({fmt(totalBgn, 'BGN')})</span>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Right: status & PDF */}
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface-container p-5 space-y-4">
            <h2 className="font-title-md text-on-surface">Статус</h2>
            <select
              value={editStatus || purchase.status || 'PENDING'}
              onChange={e => setEditStatus(e.target.value)}
              className="w-full bg-surface-variant border border-outline-variant rounded-xl px-3 py-2 text-on-surface font-body-md"
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={() => patch.mutate({ status: editStatus || purchase.status })}
              disabled={patch.isPending}
              className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-label-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {patch.isPending ? 'Запазване…' : saved || 'Запази статус'}
            </button>
          </div>

          {driveViewUrl && (
            <div className="rounded-2xl bg-surface-container p-5 space-y-3">
              <h2 className="font-title-md text-on-surface">PDF документ</h2>
              <button
                onClick={() => setShowPdf(v => !v)}
                className="w-full py-2.5 rounded-xl bg-surface-variant hover:bg-surface-variant/80 transition-colors font-label-md text-on-surface flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                {showPdf ? 'Скрий PDF' : 'Виж PDF'}
              </button>
              {showPdf && (
                <iframe
                  src={driveViewUrl}
                  className="w-full rounded-xl border border-outline-variant"
                  style={{ height: 500 }}
                  title={`Purchase ${purchase.invoiceNo || purchase.id}`}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
