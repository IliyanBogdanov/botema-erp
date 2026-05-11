'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

function GoogleOAuthSection() {
  const { data: status, isLoading, refetch } = useQuery({
    queryKey: ['google-status'],
    queryFn: () => api.get('/google/status').then(r => r.data),
    refetchInterval: 10000,
  });

  const testDigest = useMutation({
    mutationFn: () => api.post('/alerts/digest').then(r => r.data),
  });

  if (isLoading) return null;

  const connected = status?.gmailOk && status?.driveOk;

  return (
    <div className="bg-surface-container-low border border-outline-variant/10 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-label-caps text-label-caps text-on-surface">Google интеграция</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            Gmail за email дайджест · Drive за документи
          </p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 border font-label-caps text-[10px] ${
          connected
            ? 'border-[#30d158]/30 bg-[#30d158]/10 text-[#30d158]'
            : 'border-outline-variant/20 text-on-surface-variant'
        }`}>
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-[#30d158] animate-pulse' : 'bg-on-surface-variant/30'}`} />
          {connected ? 'СВЪРЗАН' : 'НЕ Е СВЪРЗАН'}
        </div>
      </div>

      {connected ? (
        <div className="space-y-3">
          <div className="flex gap-2 text-[10px] font-label-caps text-on-surface-variant">
            <span className={`flex items-center gap-1 ${status.gmailOk ? 'text-[#30d158]' : 'text-error'}`}>
              <span className="material-symbols-outlined text-[14px]">{status.gmailOk ? 'check_circle' : 'cancel'}</span>
              Gmail
            </span>
            <span className={`flex items-center gap-1 ${status.driveOk ? 'text-[#30d158]' : 'text-error'}`}>
              <span className="material-symbols-outlined text-[14px]">{status.driveOk ? 'check_circle' : 'cancel'}</span>
              Drive
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => testDigest.mutate()}
              disabled={testDigest.isPending}
              className="btn-secondary text-xs py-1.5 px-4 flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[14px]">forward_to_inbox</span>
              {testDigest.isPending ? 'Изпращане…' : 'Тест дайджест'}
            </button>
            {testDigest.isSuccess && (
              <span className="font-label-caps text-[10px] text-[#30d158] flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">check_circle</span>
                {(testDigest.data as any)?.skipped ? 'Няма активни сигнали' : `Изпратен до ${(testDigest.data as any)?.recipient}`}
              </span>
            )}
            {testDigest.isError && (
              <span className="font-label-caps text-[10px] text-error flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">error</span>
                Грешка при изпращане
              </span>
            )}
          </div>
          <p className="font-label-caps text-[10px] text-on-surface-variant/50">
            Автоматичен дайджест: всеки ден в 08:30 ч. на {process.env.NEXT_PUBLIC_ALERT_EMAIL || 'ALERT_EMAIL_TO'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {!status?.hasClientId || !status?.hasSecret ? (
            <div className="bg-error/10 border border-error/20 px-3 py-2 font-body-sm text-body-sm text-on-surface">
              Липсват <code className="text-error">GOOGLE_CLIENT_ID</code> и <code className="text-error">GOOGLE_CLIENT_SECRET</code> в .env файла на backend-а.
            </div>
          ) : (
            <div className="space-y-2">
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Влез в Google акаунта на студиото, за да разрешиш достъп до Gmail и Drive.
              </p>
              <a
                href={`${process.env.NEXT_PUBLIC_API_URL}/api/google/login`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary inline-flex items-center gap-2 text-sm py-2 px-4"
                onClick={() => setTimeout(() => refetch(), 5000)}
              >
                <span className="material-symbols-outlined text-[16px]">login</span>
                Свържи с Google
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RatesSection() {
  const { data: rates, isLoading } = useQuery({
    queryKey: ['rates'],
    queryFn: () => api.get('/rates').then(r => r.data),
    staleTime: 60 * 60 * 1000,
  });

  return (
    <div className="bg-surface-container-low border border-outline-variant/10 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-label-caps text-label-caps text-on-surface">Валутни курсове</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
            EUR/BGN е фиксиран с валутен борд · Останалите от ECB
          </p>
        </div>
        {rates?.fetchedAt && (
          <span className="font-label-caps text-[10px] text-on-surface-variant/50">
            Актуализирани: {new Date(rates.fetchedAt).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="h-8 w-48 bg-surface-container-high animate-pulse" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'EUR/BGN', value: rates?.eurBgn?.toFixed(5), note: 'фиксиран' },
            { label: 'USD/EUR', value: rates?.usdEur ? (1 / rates.usdEur).toFixed(4) : '—', note: 'референтен' },
            { label: 'GBP/EUR', value: rates?.gbpEur ? (1 / rates.gbpEur).toFixed(4) : '—', note: 'референтен' },
            { label: 'CHF/EUR', value: rates?.chfEur ? (1 / rates.chfEur).toFixed(4) : '—', note: 'референтен' },
          ].map(r => (
            <div key={r.label} className="bg-surface-container p-3 border border-outline-variant/10">
              <p className="font-label-caps text-[10px] text-on-surface-variant mb-1">{r.label}</p>
              <p className="font-data-mono text-[16px] text-on-surface">{r.value ?? '—'}</p>
              <p className="font-label-caps text-[9px] text-on-surface-variant/50 mt-0.5">{r.note}</p>
            </div>
          ))}
        </div>
      )}
      {rates?.error && (
        <p className="font-label-caps text-[10px] text-error/70">{rates.note}</p>
      )}
    </div>
  );
}

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

      <GoogleOAuthSection />
      <RatesSection />
    </div>
  );
}
