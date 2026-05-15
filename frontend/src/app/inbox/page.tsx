'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, fmtDate } from '@/lib/api';
import { useT } from '@/lib/i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GmailMessage {
  id: string;
  messageId: string;
  threadId?: string;
  subject: string;
  from?: string;
  snippet?: string;
  date?: string;
  hasAttachments: boolean;
  attachmentNames: string[];
  bodyText?: string;
  status: 'PENDING' | 'CLASSIFIED' | 'IGNORED';
  classification?: string;
  classifiedType?: string;
  notes?: string;
  reviewedAt?: string;
  createdAt: string;
}

const TYPE_OPTIONS = [
  { value: 'INVOICE_IN',    icon: 'receipt_long',    label: 'Входяща фактура',   color: 'text-primary' },
  { value: 'INVOICE_OUT',   icon: 'send',            label: 'Изходяща фактура',  color: 'text-secondary' },
  { value: 'PROFORMA',      icon: 'description',     label: 'Проформа / Оферта', color: 'text-[#ffd60a]' },
  { value: 'DELIVERY',      icon: 'local_shipping',  label: 'Delivery Note',     color: 'text-[#30d158]' },
  { value: 'PAYMENT',       icon: 'payments',        label: 'Плащане',           color: 'text-[#64d2ff]' },
  { value: 'CONTRACT',      icon: 'handshake',       label: 'Договор',           color: 'text-[#bf5af2]' },
  { value: 'INQUIRY',       icon: 'forum',           label: 'Запитване',         color: 'text-on-surface-variant' },
  { value: 'OTHER',         icon: 'more_horiz',      label: 'Друго',             color: 'text-on-surface-variant' },
];

const STATUS_FILTERS = [
  { value: '',           label: 'Всички' },
  { value: 'PENDING',    label: 'Нови' },
  { value: 'CLASSIFIED', label: 'Класифицирани' },
  { value: 'IGNORED',    label: 'Игнорирани' },
];

// ─── Classify Modal ───────────────────────────────────────────────────────────

function ClassifyModal({
  msg,
  onClose,
}: {
  msg: GmailMessage | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [type, setType] = useState('');
  const [notes, setNotes] = useState('');
  const [classification, setClassification] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: { status: string; classifiedType?: string; classification?: string; notes?: string }) =>
      api.patch(`/gmail-inbox/${msg!.id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gmail-inbox'] });
      onClose();
    },
  });

  if (!msg) return null;

  const fromName = msg.from?.replace(/<[^>]+>/, '').trim() || 'Непознат';
  const fromEmail = msg.from?.match(/<([^>]+)>/)?.[1] || msg.from || '';

  const handleClassify = () => {
    if (!type) return;
    mutation.mutate({
      status: 'CLASSIFIED',
      classifiedType: type,
      classification: classification || TYPE_OPTIONS.find(t => t.value === type)?.label,
      notes,
    });
  };

  const handleIgnore = () => {
    mutation.mutate({ status: 'IGNORED', notes: notes || 'Игнориран от потребител' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-surface-container-low border border-outline-variant/20 shadow-2xl">

        {/* Header */}
        <div className="border-b border-outline-variant/10 p-5">
          <p className="font-label-caps text-label-caps text-primary mb-1">КЛАСИФИКАЦИЯ НА ИМЕЙЛ</p>
          <h3 className="font-headline text-[18px] text-on-surface leading-snug line-clamp-2">
            {msg.subject}
          </h3>
          <div className="mt-2 flex items-center gap-2 text-xs text-on-surface-variant">
            <span className="material-symbols-outlined text-[14px]">person</span>
            <span className="font-medium text-on-surface">{fromName}</span>
            {fromEmail && <span className="text-outline">&lt;{fromEmail}&gt;</span>}
          </div>
          {msg.hasAttachments && (
            <div className="mt-2 flex flex-wrap gap-1">
              {msg.attachmentNames.map(a => (
                <span key={a} className="inline-flex items-center gap-1 bg-surface-container px-2 py-0.5 text-[10px] font-label-caps text-primary border border-primary/20">
                  <span className="material-symbols-outlined text-[12px]">attach_file</span>
                  {a}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Snippet */}
        {msg.snippet && (
          <div className="px-5 pt-4 pb-2">
            <p className="text-xs text-on-surface-variant italic line-clamp-3">{msg.snippet}</p>
          </div>
        )}

        {/* Question */}
        <div className="p-5 space-y-4">
          <p className="font-label-caps text-label-caps text-on-surface-variant">
            КАКЪВ Е ТОЗА ИМЕЙЛ?
          </p>

          <div className="grid grid-cols-2 gap-2">
            {TYPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setType(opt.value)}
                className={`flex items-center gap-3 p-3 border text-left transition-colors ${
                  type === opt.value
                    ? 'border-primary bg-primary/10'
                    : 'border-outline-variant/20 bg-surface-container hover:border-outline-variant/40 hover:bg-surface-container-high'
                }`}
              >
                <span className={`material-symbols-outlined text-[20px] flex-shrink-0 ${opt.color}`}>
                  {opt.icon}
                </span>
                <span className="font-label-caps text-label-caps text-on-surface text-[10px]">
                  {opt.label}
                </span>
                {type === opt.value && (
                  <span className="ml-auto material-symbols-outlined text-[16px] text-primary">check_circle</span>
                )}
              </button>
            ))}
          </div>

          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1.5">
              БЕЛЕЖКИ (незадължително)
            </label>
            <textarea
              className="input w-full text-sm"
              rows={2}
              placeholder="Доп. информация за тоя имейл..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="border-t border-outline-variant/10 p-4 flex justify-between items-center">
          <button
            onClick={handleIgnore}
            disabled={mutation.isPending}
            className="flex items-center gap-2 text-on-surface-variant hover:text-error font-label-caps text-label-caps transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">hide_source</span>
            Игнорирай
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary">Отказ</button>
            <button
              onClick={handleClassify}
              disabled={!type || mutation.isPending}
              className="btn-primary disabled:opacity-40"
            >
              {mutation.isPending ? 'Запис...' : 'Потвърди'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Message Card ─────────────────────────────────────────────────────────────

function MessageCard({
  msg,
  isSelected,
  onClick,
}: {
  msg: GmailMessage;
  isSelected: boolean;
  onClick: () => void;
}) {
  const fromName = msg.from?.replace(/<[^>]+>/, '').trim().replace(/"/g, '') || 'Непознат';
  const typeOpt = TYPE_OPTIONS.find(t => t.value === msg.classifiedType);

  return (
    <div
      onClick={onClick}
      className={`relative cursor-pointer border-b border-outline-variant/5 p-4 transition-colors ${
        isSelected
          ? 'bg-surface-container-high'
          : 'hover:bg-surface-container-high/50'
      } ${msg.status === 'PENDING' ? 'border-l-2 border-l-primary' : ''}`}
    >
      {isSelected && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary" />}
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-body-sm font-semibold text-on-surface text-[13px] truncate max-w-[70%]">
          {fromName}
        </span>
        <span className="font-data-mono text-[10px] text-on-surface-variant flex-shrink-0">
          {msg.date ? new Date(msg.date).toLocaleDateString('bg-BG', { day: '2-digit', month: 'short' }) : '—'}
        </span>
      </div>

      <p className="font-body-sm text-[12px] text-on-surface truncate mb-1">{msg.subject}</p>
      <p className="font-body-sm text-[11px] text-on-surface-variant line-clamp-1 mb-2">{msg.snippet}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {msg.status === 'PENDING' && (
            <span className="inline-flex items-center gap-1 bg-primary/10 border border-primary/20 px-2 py-0.5 font-label-caps text-[9px] text-primary">
              <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block animate-pulse" />
              НОВ
            </span>
          )}
          {msg.status === 'CLASSIFIED' && typeOpt && (
            <span className={`inline-flex items-center gap-1 font-label-caps text-[9px] ${typeOpt.color}`}>
              <span className="material-symbols-outlined text-[12px]">{typeOpt.icon}</span>
              {typeOpt.label}
            </span>
          )}
          {msg.status === 'IGNORED' && (
            <span className="font-label-caps text-[9px] text-on-surface-variant">Игнориран</span>
          )}
        </div>
        {msg.hasAttachments && (
          <span className="material-symbols-outlined text-[14px] text-primary" title={msg.attachmentNames.join(', ')}>
            attach_file
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  msg,
  onClassify,
  onIgnore,
}: {
  msg: GmailMessage | null;
  onClassify: () => void;
  onIgnore: () => void;
}) {
  if (!msg) {
    return (
      <div className="flex-1 bg-surface-container-lowest border border-outline-variant/10 flex items-center justify-center">
        <div className="text-center text-on-surface-variant">
          <span className="material-symbols-outlined text-[64px] block mb-4 text-outline">mark_email_unread</span>
          <p className="font-label-caps text-label-caps">Избери имейл за преглед</p>
          <p className="font-body-sm text-body-sm mt-1 text-outline">Кликни на имейл вляво</p>
        </div>
      </div>
    );
  }

  const fromName = msg.from?.replace(/<[^>]+>/, '').trim().replace(/"/g, '') || 'Непознат';
  const fromEmail = msg.from?.match(/<([^>]+)>/)?.[1] || msg.from || '';
  const typeOpt = TYPE_OPTIONS.find(t => t.value === msg.classifiedType);

  return (
    <div className="flex-1 bg-surface-container-lowest border border-outline-variant/10 flex flex-col overflow-hidden">
      {/* Email header */}
      <div className="border-b border-outline-variant/10 p-5 flex-shrink-0 bg-surface-container-low">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="font-headline text-[17px] text-on-surface leading-snug mb-3">{msg.subject}</h3>
            <div className="flex items-center gap-2 text-xs text-on-surface-variant">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-[16px] text-primary">person</span>
              </div>
              <div>
                <div className="font-semibold text-on-surface">{fromName}</div>
                <div className="text-outline">{fromEmail}</div>
              </div>
            </div>
            {msg.date && (
              <div className="mt-2 font-data-mono text-[11px] text-on-surface-variant">
                {new Date(msg.date).toLocaleString('bg-BG', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
          </div>

          {/* Status badge */}
          {msg.status === 'CLASSIFIED' && typeOpt && (
            <div className="flex-shrink-0 flex items-center gap-2 bg-surface-container border border-outline-variant/20 px-3 py-2">
              <span className={`material-symbols-outlined text-[18px] ${typeOpt.color}`}>{typeOpt.icon}</span>
              <span className="font-label-caps text-label-caps text-on-surface text-[10px]">{typeOpt.label}</span>
            </div>
          )}
        </div>
      </div>

      {/* Attachments */}
      {msg.hasAttachments && (
        <div className="border-b border-outline-variant/10 px-5 py-3 flex-shrink-0 bg-surface-container">
          <p className="font-label-caps text-label-caps text-on-surface-variant mb-2">ПРИЛОЖЕНИЯ</p>
          <div className="flex flex-wrap gap-2">
            {msg.attachmentNames.map(a => (
              <span key={a} className="inline-flex items-center gap-1.5 border border-primary/20 bg-primary/5 px-3 py-1.5 font-label-caps text-[10px] text-primary">
                <span className="material-symbols-outlined text-[14px]">picture_as_pdf</span>
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {msg.bodyText ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant whitespace-pre-line leading-relaxed">
            {msg.bodyText}
          </p>
        ) : (
          <p className="font-body-sm text-body-sm text-outline italic">{msg.snippet || 'Няма съдържание'}</p>
        )}
        {msg.notes && (
          <div className="mt-4 border-t border-outline-variant/10 pt-4">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-1">БЕЛЕЖКИ</p>
            <p className="font-body-sm text-body-sm text-on-surface">{msg.notes}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {msg.status === 'PENDING' && (
        <div className="border-t border-outline-variant/10 p-4 flex items-center justify-between bg-surface-container-low flex-shrink-0">
          <button
            onClick={onIgnore}
            className="flex items-center gap-2 font-label-caps text-label-caps text-on-surface-variant hover:text-error transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">hide_source</span>
            Игнорирай
          </button>
          <button onClick={onClassify} className="btn-primary flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">label</span>
            Какъв е тоя имейл?
          </button>
        </div>
      )}
      {msg.status === 'CLASSIFIED' && (
        <div className="border-t border-outline-variant/10 p-4 flex items-center justify-between bg-surface-container-low flex-shrink-0">
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Класифициран: {msg.reviewedAt ? fmtDate(msg.reviewedAt) : '—'}
          </p>
          <button onClick={onClassify} className="btn-secondary flex items-center gap-2 text-xs">
            <span className="material-symbols-outlined text-[16px]">edit</span>
            Промени класификацията
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<GmailMessage | null>(null);
  const [classifying, setClassifying] = useState<GmailMessage | null>(null);
  const t = useT();
  const qc = useQueryClient();

  const { data: allMessages = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['gmail-inbox'],
    queryFn: () => api.get('/gmail-inbox?limit=500').then(r => r.data),
    staleTime: 60000,
  });

  const ignoreMsg = useMutation({
    mutationFn: (id: string) => api.patch(`/gmail-inbox/${id}`, { status: 'IGNORED', notes: 'Игнориран' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gmail-inbox'] }),
  });

  const messages: GmailMessage[] = Array.isArray(allMessages) ? allMessages : [];
  const filtered = messages
    .filter(m => !statusFilter || m.status === statusFilter)
    .filter(m => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (m.from || '').toLowerCase().includes(q) ||
             (m.subject || '').toLowerCase().includes(q) ||
             (m.snippet || '').toLowerCase().includes(q);
    });

  const pendingCount = messages.filter(m => m.status === 'PENDING').length;
  const classifiedCount = messages.filter(m => m.status === 'CLASSIFIED').length;

  return (
    <div className="min-h-screen bg-surface-container-lowest">
      <div className="p-container-padding max-w-[1600px] mx-auto space-y-6">

        {/* Header */}
        <section className="flex items-end justify-between">
          <div>
            <p className="font-label-caps text-label-caps text-primary mb-2">СЛУЖЕБНА ПОЩА</p>
            <h1 className="font-headline text-headline-lg text-on-surface">Входяща поща</h1>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
              Преглеждай имейли и ги класифицирай кейс по кейс
            </p>
          </div>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <div className="bg-primary/10 border border-primary/20 px-4 py-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                <span className="font-label-caps text-label-caps text-primary">{pendingCount} НОВИ</span>
              </div>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="btn-secondary flex items-center gap-2"
            >
              <span className={`material-symbols-outlined text-[18px] ${isFetching ? 'animate-spin' : ''}`}>
                sync
              </span>
              {isFetching ? 'Зарежда...' : 'Обнови'}
            </button>
          </div>
        </section>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'ОБЩО', value: messages.length, icon: 'inbox' },
            { label: 'НОВИ', value: pendingCount, icon: 'mark_email_unread', highlight: pendingCount > 0 },
            { label: 'КЛАСИФИЦИРАНИ', value: classifiedCount, icon: 'label' },
          ].map(s => (
            <div key={s.label} className={`bg-surface-container-low border p-4 flex items-center gap-4 ${s.highlight ? 'border-primary/30' : 'border-outline-variant/10'}`}>
              <div className={`w-10 h-10 flex items-center justify-center border ${s.highlight ? 'border-primary/30 bg-primary/10' : 'border-outline-variant/10 bg-surface-container'}`}>
                <span className={`material-symbols-outlined text-[20px] ${s.highlight ? 'text-primary' : 'text-on-surface-variant'}`}>{s.icon}</span>
              </div>
              <div>
                <p className="font-headline text-[22px] text-on-surface">{s.value}</p>
                <p className="font-label-caps text-label-caps text-on-surface-variant">{s.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Filter tabs + search */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-surface-container border border-outline-variant/20 p-1 w-fit">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`px-4 py-1.5 font-label-caps text-label-caps transition-colors ${
                  statusFilter === f.value
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-[360px]">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant">search</span>
            <input
              className="input w-full py-2 pl-10 text-sm"
              placeholder="Търси по подател, тема..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Split panel */}
        <div className="grid grid-cols-12 gap-4" style={{ height: 'calc(100vh - 400px)', minHeight: '500px' }}>

          {/* Left: message list */}
          <div className="col-span-4 bg-surface-container-low border border-outline-variant/10 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-outline-variant/10 bg-surface-container flex justify-between items-center flex-shrink-0">
              <span className="font-label-caps text-label-caps text-on-surface-variant">
                {filtered.length} имейла
              </span>
              {pendingCount > 0 && (
                <span className="font-label-caps text-[9px] text-primary animate-pulse">
                  ● {pendingCount} ЧАКАТ
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                [...Array(6)].map((_, i) => (
                  <div key={i} className="p-4 border-b border-outline-variant/5 animate-pulse">
                    <div className="h-3 bg-surface-container-high rounded mb-2 w-3/4" />
                    <div className="h-3 bg-surface-container-high rounded w-full mb-2" />
                    <div className="h-3 bg-surface-container rounded w-1/2" />
                  </div>
                ))
              ) : isError ? (
                <div className="p-8 text-center">
                  <span className="material-symbols-outlined text-[40px] text-error block mb-2">error</span>
                  <p className="font-body-sm text-error text-sm">Gmail не е свързан</p>
                  <p className="font-body-sm text-on-surface-variant text-xs mt-1">Провери GOOGLE_REFRESH_TOKEN в Railway</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-10 text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-[48px] block mb-3 text-outline">inbox</span>
                  <p className="font-body-sm text-sm">Няма имейли</p>
                </div>
              ) : (
                filtered.map(msg => (
                  <MessageCard
                    key={msg.id}
                    msg={msg}
                    isSelected={selected?.id === msg.id}
                    onClick={() => setSelected(msg)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div className="col-span-8 flex">
            <DetailPanel
              msg={selected}
              onClassify={() => selected && setClassifying(selected)}
              onIgnore={() => selected && ignoreMsg.mutate(selected.id)}
            />
          </div>
        </div>
      </div>

      {/* Classify modal */}
      {classifying && (
        <ClassifyModal
          msg={classifying}
          onClose={() => setClassifying(null)}
        />
      )}
    </div>
  );
}
