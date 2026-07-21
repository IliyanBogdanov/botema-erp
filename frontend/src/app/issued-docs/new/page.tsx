'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Plus, Trash2, ArrowLeft } from 'lucide-react';

const DOC_TYPES = [
  { value: 'PROFORMA', label: 'Проформа фактура' },
  { value: 'OFFER', label: 'Оферта' },
  { value: 'PROTOCOL', label: 'Приемо-предавателен протокол' },
  { value: 'WARRANTY', label: 'Гаранционна карта' },
  { value: 'DELIVERY_NOTE', label: 'Доставъчна бележка' },
  { value: 'CREDIT_NOTE', label: 'Кредитно известие' },
];

const VAT_RATES = [0, 9, 20];
const UNITS = ['бр.', 'м²', 'м', 'кг', 'л', 'компл.', 'услуга', 'час'];

interface LineItem {
  description: string;
  qty: string;
  unitPrice: string;
  vatPct: string;
  unit: string;
  imageUrl: string;
}

const emptyLine = (): LineItem => ({
  description: '', qty: '1', unitPrice: '0', vatPct: '20', unit: 'бр.', imageUrl: '',
});

export default function NewIssuedDocPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    type: 'PROFORMA',
    number: '',
    date: new Date().toISOString().slice(0, 10),
    dueDate: '',
    clientId: '',
    projectId: '',
    currency: 'EUR',
    description: '',
    notes: '',
    brand: 'STUDIO_BOTEMA',
  });
  const [lines, setLines] = useState<LineItem[]>([emptyLine()]);
  const [error, setError] = useState('');

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: () => api.get('/projects').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: (payload: any) => api.post('/issued-docs', payload),
    onSuccess: (res) => {
      router.push(`/issued-docs/${res.data.id}/print`);
    },
    onError: (err: any) => setError(err.response?.data?.error || 'Грешка при запис'),
  });

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const setLine = (i: number, k: keyof LineItem, v: string) =>
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, [k]: v } : l));

  const addLine = () => setLines(ls => [...ls, emptyLine()]);
  const removeLine = (i: number) => setLines(ls => ls.filter((_, idx) => idx !== i));

  const calcLine = (l: LineItem) => {
    const qty = parseFloat(l.qty) || 0;
    const price = parseFloat(l.unitPrice) || 0;
    const vat = parseFloat(l.vatPct) || 0;
    const net = qty * price;
    return { net, vatAmt: net * (vat / 100), total: net * (1 + vat / 100) };
  };

  const totals = lines.reduce((acc, l) => {
    const c = calcLine(l);
    return { net: acc.net + c.net, vat: acc.vat + c.vatAmt, total: acc.total + c.total };
  }, { net: 0, vat: 0, total: 0 });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    mutation.mutate({
      ...form,
      items: lines.filter(l => l.description.trim()),
    });
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-on-surface-variant hover:text-primary transition-colors font-body-sm">
          <ArrowLeft size={15} /> Назад
        </button>
        <div>
          <h1 className="font-headline text-headline-md text-on-surface">Нов документ</h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant">Проформа, оферта, протокол, гаранция</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Document meta */}
        <div className="border border-outline-variant/10 bg-surface-container-low p-5 space-y-4">
          <p className="font-label-caps text-label-caps text-on-surface-variant">ТИП И ОСНОВНА ИНФОРМАЦИЯ</p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="col-span-2 md:col-span-1">
              <label className="block text-xs text-on-surface-variant mb-1">Вид документ *</label>
              <select className="input" value={form.type} onChange={e => setField('type', e.target.value)}>
                {DOC_TYPES.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Номер (авто ако е празно)</label>
              <input className="input" value={form.number} onChange={e => setField('number', e.target.value)}
                placeholder="PF-2025-0001" />
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Валута</label>
              <select className="input" value={form.currency} onChange={e => setField('currency', e.target.value)}>
                <option value="BGN">BGN (лв.)</option>
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Дата *</label>
              <input type="date" required className="input" value={form.date} onChange={e => setField('date', e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Срок на валидност</label>
              <input type="date" className="input" value={form.dueDate} onChange={e => setField('dueDate', e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Клиент</label>
              <select className="input" value={form.clientId} onChange={e => setField('clientId', e.target.value)}>
                <option value="">— Избери клиент —</option>
                {(clients as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-on-surface-variant mb-1">Проект</label>
              <select className="input" value={form.projectId} onChange={e => setField('projectId', e.target.value)}>
                <option value="">— Без проект —</option>
                {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.code} – {p.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-on-surface-variant mb-1">Описание / заглавие</label>
            <input className="input" value={form.description} onChange={e => setField('description', e.target.value)}
              placeholder="Напр. Дизайн и доставка осветление за обект..." />
          </div>
        </div>

        {/* Line items */}
        <div className="border border-outline-variant/10 bg-surface-container-low p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-label-caps text-label-caps text-on-surface-variant">АРТИКУЛИ / УСЛУГИ</p>
            <button type="button" onClick={addLine}
              className="flex items-center gap-1 text-xs text-primary hover:underline">
              <Plus size={13} /> Добави ред
            </button>
          </div>

          {/* Header */}
          <div className="grid grid-cols-12 gap-2 text-[9px] font-semibold text-on-surface-variant/50 uppercase tracking-wider px-1">
            <div className="col-span-4">Описание</div>
            <div className="col-span-1">Ед.</div>
            <div className="col-span-1 text-right">Кол.</div>
            <div className="col-span-2 text-right">Ед. цена</div>
            <div className="col-span-1 text-right">ДДС%</div>
            <div className="col-span-2 text-right">Общо</div>
            <div className="col-span-1"></div>
          </div>

          {lines.map((line, i) => {
            const { total } = calcLine(line);
            return (
              <div key={i} className="space-y-2">
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-4">
                    <input
                      className="input text-xs"
                      placeholder="Описание на артикул или услуга"
                      value={line.description}
                      onChange={e => setLine(i, 'description', e.target.value)}
                    />
                  </div>
                  <div className="col-span-1">
                    <select className="input text-xs" value={line.unit} onChange={e => setLine(i, 'unit', e.target.value)}>
                      {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <input type="number" min="0" step="0.001" className="input text-xs text-right"
                      value={line.qty} onChange={e => setLine(i, 'qty', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <input type="number" min="0" step="0.01" className="input text-xs text-right"
                      value={line.unitPrice} onChange={e => setLine(i, 'unitPrice', e.target.value)} />
                  </div>
                  <div className="col-span-1">
                    <select className="input text-xs" value={line.vatPct} onChange={e => setLine(i, 'vatPct', e.target.value)}>
                      {VAT_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                    </select>
                  </div>
                  <div className="col-span-2 flex items-center justify-end">
                    <span className="font-semibold text-on-surface text-xs">
                      {total.toLocaleString('bg-BG', { minimumFractionDigits: 2 })} {form.currency === 'BGN' ? 'лв.' : form.currency}
                    </span>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {lines.length > 1 && (
                      <button type="button" onClick={() => removeLine(i)}
                        className="text-error/60 hover:text-error transition-colors p-1">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Image URL (for offers) */}
                {form.type === 'OFFER' && (
                  <div className="pl-0">
                    <input
                      className="input text-xs text-on-surface-variant/60"
                      placeholder="URL на продуктова снимка (по желание)"
                      value={line.imageUrl}
                      onChange={e => setLine(i, 'imageUrl', e.target.value)}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {/* Totals */}
          <div className="border-t border-outline-variant/10 pt-3 mt-3 flex justify-end">
            <div className="space-y-1 text-right min-w-[200px]">
              <div className="flex justify-between gap-8 text-xs text-on-surface-variant">
                <span>Нето</span>
                <span className="font-mono">{totals.net.toFixed(2)} {form.currency === 'BGN' ? 'лв.' : form.currency}</span>
              </div>
              <div className="flex justify-between gap-8 text-xs text-on-surface-variant">
                <span>ДДС</span>
                <span className="font-mono">{totals.vat.toFixed(2)} {form.currency === 'BGN' ? 'лв.' : form.currency}</span>
              </div>
              <div className="flex justify-between gap-8 font-semibold text-on-surface border-t border-outline-variant/20 pt-1 mt-1">
                <span>ОБЩО</span>
                <span className="font-mono">{totals.total.toFixed(2)} {form.currency === 'BGN' ? 'лв.' : form.currency}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="border border-outline-variant/10 bg-surface-container-low p-5">
          <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2">БЕЛЕЖКИ / УСЛОВИЯ</label>
          <textarea
            className="input"
            rows={3}
            placeholder="Условия за плащане, гаранционни клаузи, бележки..."
            value={form.notes}
            onChange={e => setField('notes', e.target.value)}
          />
        </div>

        {error && (
          <div className="border border-error/30 bg-error/5 p-3 text-error text-sm">{error}</div>
        )}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => router.back()} className="btn-secondary">Отказ</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary disabled:opacity-50 flex items-center gap-2">
            {mutation.isPending ? 'Запис...' : '✓ Запази и отвори за печат'}
          </button>
        </div>
      </form>
    </div>
  );
}
