'use client';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, fmtDate, fmt } from '@/lib/api';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';

const DOC_TYPE_LABELS: Record<string, string> = {
  PROFORMA: 'Проформа', OFFER: 'Оферта', PROTOCOL: 'Протокол',
  WARRANTY: 'Гаранция', DELIVERY_NOTE: 'Доставъчна бел.', CREDIT_NOTE: 'Кредитно изв.',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Чакащ', PAID: 'Платено', OVERDUE: 'Просрочено', CANCELLED: 'Анулиран',
};

export default function IssuedDocDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: doc, isLoading } = useQuery({
    queryKey: ['issued-doc', id],
    queryFn: () => api.get(`/issued-docs/${id}`).then(r => r.data),
    enabled: !!id,
  });

  if (isLoading) return (
    <div className="p-8 space-y-4 animate-pulse">
      {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-surface-container-low border border-outline-variant/10" />)}
    </div>
  );
  if (!doc) return <div className="p-8 text-error">Документът не е намерен.</div>;

  const items = doc.items || [];
  const typeLabel = DOC_TYPE_LABELS[doc.type] || doc.type;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()}
            className="flex items-center gap-1.5 text-on-surface-variant hover:text-primary transition-colors font-body-sm">
            <ArrowLeft size={15} /> Назад
          </button>
          <div>
            <h1 className="font-headline text-headline-md text-on-surface">{typeLabel} № {doc.number}</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {fmtDate(doc.date)} · {doc.client?.name || '—'} · {STATUS_LABELS[doc.status] || doc.status}
            </p>
          </div>
        </div>
        <Link href={`/issued-docs/${id}/print`} target="_blank"
          className="btn-primary flex items-center gap-2">
          <Printer size={14} /> Принт / PDF
        </Link>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {[
          { label: 'Вид', value: typeLabel },
          { label: 'Номер', value: doc.number },
          { label: 'Дата', value: fmtDate(doc.date) },
          { label: 'Клиент', value: doc.client?.name || '—' },
          { label: 'Проект', value: doc.project ? `${doc.project.code} – ${doc.project.name}` : '—' },
          { label: 'Описание', value: doc.description || '—' },
        ].map(f => (
          <div key={f.label} className="border border-outline-variant/10 bg-surface-container-low p-4">
            <p className="font-label-caps text-[9px] text-on-surface-variant/60 mb-1">{f.label}</p>
            <p className="font-body-sm text-body-sm text-on-surface">{f.value}</p>
          </div>
        ))}
      </div>

      {/* Items */}
      {items.length > 0 && (
        <div className="border border-outline-variant/10 bg-surface-container-low overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-outline-variant/10">
            <p className="font-label-caps text-label-caps text-on-surface-variant">АРТИКУЛИ</p>
          </div>
          <table className="w-full">
            <thead>
              <tr>
                {['ОПИСАНИЕ', 'ЕД.', 'КОЛ.', 'ЕД. ЦЕНА', 'ДДС%', 'ОБЩО'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item: any) => {
                const qty = Number(item.qty) || 0;
                const price = Number(item.unitPrice) || 0;
                const vat = Number(item.vatPct) || 0;
                const total = qty * price * (1 + vat / 100);
                return (
                  <tr key={item.id} className="hover:bg-surface-container transition-colors">
                    <td className="table-cell text-on-surface">{item.description}</td>
                    <td className="table-cell text-on-surface-variant text-xs">{item.unit || 'бр.'}</td>
                    <td className="table-cell text-right text-on-surface-variant">{qty}</td>
                    <td className="table-cell text-right text-on-surface-variant">{price.toFixed(2)}</td>
                    <td className="table-cell text-right text-on-surface-variant">{vat}%</td>
                    <td className="table-cell text-right font-semibold text-on-surface">{fmt(total, doc.currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-outline-variant/10 flex justify-end gap-6 text-sm">
            <span className="text-on-surface-variant">Нето: <strong>{fmt(doc.amountNet, doc.currency)}</strong></span>
            <span className="text-on-surface-variant">ДДС: <strong>{fmt(doc.vatAmount, doc.currency)}</strong></span>
            <span className="text-on-surface font-bold">Общо: {fmt(doc.amountTotal, doc.currency)}</span>
          </div>
        </div>
      )}

      {doc.notes && (
        <div className="border border-outline-variant/10 bg-surface-container-low p-4">
          <p className="font-label-caps text-[9px] text-on-surface-variant/60 mb-1">БЕЛЕЖКИ</p>
          <p className="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-wrap">{doc.notes}</p>
        </div>
      )}
    </div>
  );
}
