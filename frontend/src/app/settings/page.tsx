'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

const BRANDS = [
  { value: 'STUDIO_BOTEMA', label: 'Studio Botema ЕООД' },
  { value: 'LUMINAVERA',    label: 'LuminaVera ЕООД' },
];

const DEFAULTS: Record<string, any> = {
  STUDIO_BOTEMA: {
    name: 'СТУДИО БОТЕМА ЕООД', eik: '', vat: '',
    address: '', city: '', mol: '',
    bankIban: '', bankBic: '', bankName: '',
    email: 'office@studiobotema.com', phone: '',
  },
  LUMINAVERA: {
    name: 'ЛУМИНАВЕРА ЕООД', eik: '', vat: '',
    address: '', city: '', mol: '',
    bankIban: '', bankBic: '', bankName: '',
    email: 'office@luminavera.bg', phone: '',
  },
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Наименование *',
  eik: 'ЕИК *',
  vat: 'ДДС Номер',
  address: 'Адрес',
  city: 'Град',
  mol: 'МОЛ (Материалноотговорно лице)',
  bankName: 'Банка',
  bankIban: 'IBAN',
  bankBic: 'BIC / SWIFT',
  email: 'Email',
  phone: 'Телефон',
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const [activeBrand, setActiveBrand] = useState('STUDIO_BOTEMA');
  const [form, setForm] = useState<Record<string, string>>(DEFAULTS.STUDIO_BOTEMA);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  const { data: companies = [], isLoading } = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get('/company').then(r => r.data),
  });

  useEffect(() => {
    const company = (companies as any[]).find((c: any) => c.brand === activeBrand);
    if (company) {
      setForm({ ...DEFAULTS[activeBrand], ...company });
    } else {
      setForm(DEFAULTS[activeBrand]);
    }
  }, [activeBrand, companies]);

  const mutation = useMutation({
    mutationFn: async (payload: any) => {
      const company = (companies as any[]).find((c: any) => c.brand === activeBrand);
      if (company?.id) {
        return api.patch(`/company/${company.id}`, payload);
      }
      return api.post('/company', { brand: activeBrand, ...payload });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      setSaved('Запазено ✓');
      setTimeout(() => setSaved(''), 2500);
      setError('');
    },
    onError: (err: any) => setError(err.response?.data?.error || 'Грешка при запис'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    mutation.mutate(form);
  };

  const setField = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const activeCompany = (companies as any[]).find((c: any) => c.brand === activeBrand);

  return (
    <div className="p-container-padding max-w-3xl mx-auto space-y-8">
      <div>
        <p className="font-label-caps text-label-caps text-primary mb-1">НАСТРОЙКИ</p>
        <h1 className="font-headline text-headline-lg text-on-surface">Фирмени данни</h1>
        <p className="font-body-sm text-on-surface-variant mt-1">
          Тези данни се появяват в печатните документи — оферти, проформи, протоколи.
        </p>
      </div>

      {/* Brand tabs */}
      <div className="flex gap-1 border border-outline-variant/20 p-1 bg-surface-container-low w-fit">
        {BRANDS.map(b => (
          <button
            key={b.value}
            onClick={() => setActiveBrand(b.value)}
            className={`px-5 py-2.5 font-label-caps text-label-caps transition-colors ${
              activeBrand === b.value
                ? 'bg-primary-container text-on-primary-container'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="h-40 flex items-center justify-center text-on-surface-variant">Зареждане...</div>
      ) : (
        <form onSubmit={handleSubmit} className="bg-surface-container-low border border-outline-variant/10 p-8 space-y-6">
          {!activeCompany && (
            <div className="bg-primary-container/10 border border-primary-container/30 px-4 py-3 text-body-sm text-on-surface">
              Все още няма записани данни за тази фирма. Попълнете формата и натиснете „Запази".
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {Object.entries(FIELD_LABELS).map(([key, label]) => (
              <div key={key} className={key === 'name' || key === 'mol' || key === 'address' ? 'col-span-2' : ''}>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">{label}</label>
                <input
                  className="input w-full"
                  value={form[key] || ''}
                  onChange={e => setField(key, e.target.value)}
                  placeholder={label.replace(' *', '')}
                  required={label.includes('*')}
                />
              </div>
            ))}
          </div>

          {error && (
            <div className="bg-error-container/20 border border-error/30 px-3 py-2">
              <p className="text-error text-body-sm">{error}</p>
            </div>
          )}

          {saved && (
            <div className="bg-primary-container/15 border border-primary-container/30 px-3 py-2">
              <p className="text-primary text-body-sm">{saved}</p>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={mutation.isPending} className="btn-primary disabled:opacity-50 min-w-32">
              {mutation.isPending ? 'Запис...' : 'Запази'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-surface-container-low border border-outline-variant/10 p-6 space-y-3">
        <h3 className="font-label-caps text-label-caps text-on-surface">Акаунти</h3>
        <div className="text-body-sm text-on-surface-variant space-y-1">
          <div>Admin: <span className="text-on-surface font-medium">office@studiobotema.com</span></div>
          <div>Staff: <span className="text-on-surface font-medium">office@luminavera.com</span></div>
        </div>
        <p className="font-label-caps text-[10px] text-on-surface-variant/50">
          За промяна на парола — свържете се с администратора.
        </p>
      </div>
    </div>
  );
}
