'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { api, fmtDate } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { StatusBadge } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';

interface Project {
  id: string;
  code: string;
  name: string;
  status: string;
  year: number;
  revenue?: number;
  costs?: number;
  invoiceCount?: number;
  client?: { id: string; name: string };
}

const modalLabelClass = 'block font-label-caps text-label-caps text-on-surface-variant mb-1.5';
const projectImages = [
  'https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=600&q=60',
  'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=600&q=60',
  'https://images.unsplash.com/photo-1600210492493-0946911123ea?w=600&q=60',
];
function getStatusTabs(t: ReturnType<typeof useT>) {
  return [
    { label: t('proj.all'), value: '' },
    { label: t('proj.active'), value: 'ACTIVE' },
    { label: t('proj.completed'), value: 'COMPLETED' },
    { label: t('proj.onHold'), value: 'ON_HOLD' },
  ];
}
const yearTabs = [2024, 2025, 2026];

function ProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    code: '', name: '', clientId: '', status: 'ACTIVE',
    year: new Date().getFullYear(), notes: '',
    startDate: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState('');

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get('/clients').then(r => r.data),
  });

  const mutation = useMutation({
    mutationFn: (payload: any) => api.post('/projects', payload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); onClose(); },
    onError: (err: any) => setError(err.response?.data?.message || 'Грешка при запис'),
  });

  const setField = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Modal open={open} onClose={onClose} title="Нов проект" size="md">
      <form onSubmit={e => { e.preventDefault(); mutation.mutate(form); }} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={modalLabelClass}>Код *</label>
            <input required className="input" value={form.code} onChange={e => setField('code', e.target.value)} placeholder="SB-2025-001" />
          </div>
          <div>
            <label className={modalLabelClass}>Година</label>
            <input type="number" className="input" value={form.year} onChange={e => setField('year', Number(e.target.value))} />
          </div>
        </div>

        <div>
          <label className={modalLabelClass}>Наименование *</label>
          <input required className="input" value={form.name} onChange={e => setField('name', e.target.value)} placeholder="Описание на проекта" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={modalLabelClass}>Клиент</label>
            <select className="input" value={form.clientId} onChange={e => setField('clientId', e.target.value)}>
              <option value="">— Без клиент —</option>
              {(clients as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className={modalLabelClass}>Статус</label>
            <select className="input" value={form.status} onChange={e => setField('status', e.target.value)}>
              <option value="ACTIVE">Активен</option>
              <option value="COMPLETED">Приключен</option>
              <option value="ON_HOLD">Пауза</option>
              <option value="CANCELLED">Анулиран</option>
            </select>
          </div>
        </div>

        <div>
          <label className={modalLabelClass}>Начална дата</label>
          <input type="date" className="input" value={form.startDate} onChange={e => setField('startDate', e.target.value)} />
        </div>

        <div>
          <label className={modalLabelClass}>Бележки</label>
          <textarea className="input" rows={2} value={form.notes} onChange={e => setField('notes', e.target.value)} placeholder="Допълнителна информация..." />
        </div>

        {error && (
          <div className="bg-[rgba(255,69,58,0.1)] border border-[rgba(255,69,58,0.3)] rounded-lg px-3 py-2">
            <p className="text-[#ff453a] text-sm">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Отказ</button>
          <button type="submit" disabled={mutation.isPending} className="btn-primary disabled:opacity-50">
            {mutation.isPending ? 'Запис...' : 'Създай проект'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectStatusBadge({ status, activeLabel }: { status: string; activeLabel: string }) {
  const label = status === 'ACTIVE'
    ? activeLabel
    : status === 'COMPLETED'
      ? 'COMPLETED'
      : status === 'ON_HOLD'
        ? 'ON HOLD'
        : status;

  const className = status === 'ACTIVE'
    ? 'bg-primary-container/20 text-primary border-primary-container/30'
    : status === 'CANCELLED'
      ? 'bg-error-container/20 text-error border-error/30'
      : 'bg-surface-container-high text-on-surface-variant border-outline-variant/20';

  return (
    <span className={`inline-flex items-center gap-2 border px-2 py-0.5 font-label-caps text-[9px] ${className}`}>
      {status === 'ACTIVE' && <div className="h-2 w-2 rounded-full bg-primary-container shadow-[0_0_8px_rgba(62,144,255,0.4)]" />}
      {label}
    </span>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const params = new URLSearchParams();
  if (year) params.set('year', String(year));
  if (status) params.set('status', status);

  const { data = [], isLoading } = useQuery({
    queryKey: ['projects', year, status],
    queryFn: () => api.get(`/projects?${params}`).then(r => r.data),
    staleTime: 30000,
  });
  const t = useT();
  const statusTabs = getStatusTabs(t);

  const projects: Project[] = Array.isArray(data) ? data : (data as any).data || [];

  const filtered = search
    ? projects.filter(p =>
        p.code.toLowerCase().includes(search.toLowerCase()) ||
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.client?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : projects;

  return (
    <div className="min-h-screen bg-surface-container-lowest p-container-padding text-on-surface">
      <div className="mx-auto max-w-7xl space-y-section-gap">
        <section className="flex justify-between items-end mb-section-gap">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-2">{t('proj.label')}</p>
            <h2 className="font-headline text-headline-lg text-on-surface">{t('proj.title')}</h2>
          </div>
          <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px]">add</span>
            {t('proj.new')}
          </button>
        </section>

        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex gap-1 border border-outline-variant/20 bg-surface-container p-1 w-fit">
              {statusTabs.map(tab => (
                <button
                  key={tab.label}
                  onClick={() => setStatus(tab.value)}
                  className={`px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                    status === tab.value
                      ? 'bg-primary-container text-on-primary-container'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 border border-outline-variant/20 bg-surface-container p-1">
              {yearTabs.map(tabYear => (
                <button
                  key={tabYear}
                  onClick={() => setYear(tabYear)}
                  className={`px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                    year === tabYear
                      ? 'bg-primary-container text-on-primary-container'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {tabYear}
                </button>
              ))}
            </div>
          </div>

          <div className="relative">
            <span className="material-symbols-outlined pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant">search</span>
            <input
              className="input w-full py-3 pl-12"
              placeholder="Търси код, проект или клиент..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {[...Array(6)].map((_, index) => (
                <div key={index} className="h-[320px] animate-pulse bg-surface-container-low border border-outline-variant/10" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-surface-container-low border border-outline-variant/10 p-12 text-center text-on-surface-variant">
              {t('proj.none')}
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((project, index) => (
                <button
                  key={project.id}
                  onClick={() => router.push(`/projects/${project.id}`)}
                  className="group relative h-[320px] overflow-hidden border border-outline-variant/10 bg-surface-container-low text-left"
                  style={{
                    backgroundImage: `linear-gradient(180deg, rgba(14,14,16,0.08) 0%, rgba(14,14,16,0.78) 55%, rgba(14,14,16,0.94) 100%), url(${projectImages[index % projectImages.length]})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  <div className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/0" />
                  <div className="relative flex h-full flex-col justify-between p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-data-mono text-data-mono text-primary">{project.code}</p>
                        <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant">{project.client?.name || 'Без клиент'}</p>
                      </div>
                      <span className="material-symbols-outlined text-[20px] text-on-surface-variant transition-colors group-hover:text-on-surface">arrow_outward</span>
                    </div>

                    <div className="space-y-4">
                      <ProjectStatusBadge status={project.status} activeLabel={t('proj.activeLabel')} />
                      <div>
                        <h3 className="font-headline text-headline-md text-on-surface">{project.name}</h3>
                        <p className="mt-2 font-body-sm text-body-sm text-on-surface-variant">Година {project.year}</p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
                        <div>
                          <p className="font-label-caps text-label-caps text-on-surface-variant">{t('proj.revenue')}</p>
                          <p className="mt-2 font-data-mono text-data-mono text-on-surface">
                            {(project.revenue || 0).toLocaleString('bg-BG', { minimumFractionDigits: 0 })} BGN
                          </p>
                        </div>
                        <div>
                          <p className="font-label-caps text-label-caps text-on-surface-variant">{t('proj.invoices')}</p>
                          <p className="mt-2 font-data-mono text-data-mono text-on-surface">{project.invoiceCount ?? 0}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <ProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </div>
    </div>
  );
}
