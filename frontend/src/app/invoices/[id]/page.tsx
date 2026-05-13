'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmt, fmtBgn, fmtDate, statusConfig } from '@/lib/api';
import { StatusBadge } from '@/components/StatusBadge';

const BGN_PER_EUR = 1.95583;
const toBgn = (amount: number, currency: string) =>
  currency === 'EUR' ? amount * BGN_PER_EUR : amount;

const STATUS_OPTIONS = ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'];

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [showPdf, setShowPdf] = useState(false);
  const [editStatus, setEditStatus] = useState('');
  const [saved, setSaved] = useState('');

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then(r => r.data),
  });

  const patch = useMutation({
    mutationFn: (data: any) => api.patch(`/invoices/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoice', id] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setSaved('Запазено ✓');
      setTimeout(() => setSaved(''), 2000);
    },
  });

  if (isLoading) return <div className="p-8 text-on-surface-variant">Зареждане…</div>;
  if (!invoice) return <div className="p-8 text-error">Фактурата не е намерена.</div>;

  const net = Number(invoice.amountNet);
  const vat = Number(invoice.vatAmount);
  const total = Number(invoice.amountTotal);
  const totalBgn = toBgn(total, invoice.currency);

  const fileUrl = invoice.driveFileId
    ? `${process.env.NEXT_PUBLIC_API_URL}/api/invoices/${id}/file`
    : null;

  const driveViewUrl = invoice.driveFileId
    ? `https://drive.google.com/file/d/${invoice.driveFileId}/preview`
    : null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-surface-variant transition-colors">
          <span className="material-symbols-outlined text-on-surface-variant">arrow_back</span>
        </button>
        <div className="flex-1">
          <h1 className="font-display-sm text-on-surface">Фактура {invoice.number}</h1>
          <p className="font-body-sm text-on-surface-variant">
            {fmtDate(invoice.date)} · {invoice.brand === 'STUDIO_BOTEMA' ? 'Studio Botema' : 'LuminaVera'}
          </p>
        </div>
        <StatusBadge status={invoice.status} />
        <a
          href={`/invoices/${id}/print?print=1`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors font-label-md text-primary"
        >
          <span className="material-symbols-outlined text-[18px]">download</span>
          PDF
        </a>
        <a
          href={`/invoices/${id}/print`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-variant hover:bg-surface-variant/80 transition-colors font-label-md text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-[18px]">print</span>
          Принт
        </a>
        {invoice.driveFileId && (
          <a
            href={`https://drive.google.com/file/d/${invoice.driveFileId}/view`}
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
        {/* Left: invoice info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Client & Project */}
          <div className="rounded-2xl bg-surface-container p-5 space-y-3">
            <h2 className="font-title-md text-on-surface">Детайли</h2>
            <div className="grid grid-cols-2 gap-4 font-body-sm">
              <div>
                <span className="text-on-surface-variant">Клиент</span>
                <p className="text-on-surface font-medium">{invoice.client?.name || '—'}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Проект</span>
                <p className="text-on-surface font-medium">{invoice.project?.name || '—'}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Дата</span>
                <p className="text-on-surface">{fmtDate(invoice.date)}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Падеж</span>
                <p className="text-on-surface">{invoice.dueDate ? fmtDate(invoice.dueDate) : '—'}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Валута</span>
                <p className="text-on-surface">{invoice.currency}</p>
              </div>
              <div>
                <span className="text-on-surface-variant">Тип</span>
                <p className="text-on-surface">{invoice.type}</p>
              </div>
            </div>
            {invoice.description && (
              <p className="font-body-sm text-on-surface-variant border-t border-outline-variant pt-3">{invoice.description}</p>
            )}
          </div>

          {/* Line items */}
          {invoice.items?.length > 0 && (
            <div className="rounded-2xl bg-surface-container overflow-hidden">
              <table className="w-full font-body-sm">
                <thead>
                  <tr className="bg-surface-variant">
                    <th className="text-left px-4 py-3 text-on-surface-variant font-label-caps text-label-caps">Описание</th>
                    <th className="text-right px-4 py-3 text-on-surface-variant font-label-caps text-label-caps">Кол.</th>
                    <th className="text-right px-4 py-3 text-on-surface-variant font-label-caps text-label-caps">Ед. цена</th>
                    <th className="text-right px-4 py-3 text-on-surface-variant font-label-caps text-label-caps">ДДС%</th>
                    <th className="text-right px-4 py-3 text-on-surface-variant font-label-caps text-label-caps">Сума</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.items.map((item: any, i: number) => (
                    <tr key={i} className="border-t border-outline-variant">
                      <td className="px-4 py-3 text-on-surface">{item.description}</td>
                      <td className="px-4 py-3 text-right text-on-surface-variant">{Number(item.qty)}</td>
                      <td className="px-4 py-3 text-right text-on-surface">{fmt(item.unitPrice, invoice.currency)}</td>
                      <td className="px-4 py-3 text-right text-on-surface-variant">{Number(item.vatPct)}%</td>
                      <td className="px-4 py-3 text-right text-on-surface font-medium">{fmt(item.total, invoice.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-outline">
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-on-surface-variant font-label-caps text-label-caps">Нетна сума</td>
                    <td className="px-4 py-2 text-right text-on-surface">{fmt(net, invoice.currency)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4} className="px-4 py-2 text-right text-on-surface-variant font-label-caps text-label-caps">ДДС</td>
                    <td className="px-4 py-2 text-right text-on-surface">{fmt(vat, invoice.currency)}</td>
                  </tr>
                  <tr className="bg-primary/10">
                    <td colSpan={4} className="px-4 py-3 text-right font-title-sm text-on-surface">Общо</td>
                    <td className="px-4 py-3 text-right font-title-sm text-primary">
                      {fmt(total, invoice.currency)}
                      {invoice.currency === 'EUR' && (
                        <span className="text-on-surface-variant font-body-sm ml-2">({fmtBgn(totalBgn)})</span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Right: status & actions */}
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface-container p-5 space-y-4">
            <h2 className="font-title-md text-on-surface">Статус</h2>
            <select
              value={editStatus || invoice.status}
              onChange={e => setEditStatus(e.target.value)}
              className="w-full bg-surface-variant border border-outline-variant rounded-xl px-3 py-2 text-on-surface font-body-md"
            >
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={() => patch.mutate({ status: editStatus || invoice.status })}
              disabled={patch.isPending}
              className="w-full py-2.5 rounded-xl bg-primary text-on-primary font-label-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {patch.isPending ? 'Запазване…' : saved || 'Запази статус'}
            </button>
          </div>

          {/* PDF viewer toggle */}
          {(fileUrl || driveViewUrl) && (
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
                  src={driveViewUrl || fileUrl || ''}
                  className="w-full rounded-xl border border-outline-variant"
                  style={{ height: 500 }}
                  title={`Invoice ${invoice.number}`}
                />
              )}
            </div>
          )}

          {/* Notes */}
          {invoice.notes && (
            <div className="rounded-2xl bg-surface-container p-5">
              <h2 className="font-title-md text-on-surface mb-2">Бележки</h2>
              <p className="font-body-sm text-on-surface-variant whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
