'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '@/lib/store';
import { useLangStore, useT } from '@/lib/i18n';
import { api } from '@/lib/api';

const TYPE_ICONS: Record<string, string> = {
  client: 'person',
  invoice: 'receipt_long',
  project: 'design_services',
  supplier: 'local_shipping',
  purchase: 'shopping_cart',
};

const TYPE_LABELS: Record<string, string> = {
  client: 'Клиент',
  invoice: 'Фактура',
  project: 'Проект',
  supplier: 'Доставчик',
  purchase: 'Покупка',
};

const STATUS_COLORS: Record<string, string> = {
  PAID: '#30d158',
  PENDING: '#ff9f0a',
  OVERDUE: '#ff453a',
  CANCELLED: '#636366',
  ACTIVE: '#0a84ff',
  COMPLETED: '#636366',
  ON_HOLD: '#ff9f0a',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user } = useAuthStore();
  const { lang, setLang } = useLangStore();
  const isAuthPage = pathname?.startsWith('/login');
  const isPrintPage = pathname?.endsWith('/print');
  const t = useT();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthPage) {
      const token = localStorage.getItem('token');
      if (!token) router.replace('/login');
    }
  }, [pathname]);

  // Keyboard shortcut Ctrl+K / Cmd+K focuses search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        const input = searchRef.current?.querySelector('input') as HTMLInputElement;
        input?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim() || value.trim().length < 2) {
      setResults([]);
      setDropdownOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.get(`/search?q=${encodeURIComponent(value.trim())}`);
        setResults(res.data.results || []);
        setDropdownOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
  };

  const handleResultClick = (url: string) => {
    setDropdownOpen(false);
    setSearch('');
    setResults([]);
    router.push(url);
  };

  if (isAuthPage) return <>{children}</>;
  if (isPrintPage) return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar — always visible md+ */}
      <div className="hidden md:block">
        <Sidebar />
      </div>
      {/* Mobile sidebar — overlay drawer */}
      <div className="md:hidden">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </div>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 px-gutter flex items-center justify-between bg-surface-dim border-b border-outline-variant/10 flex-shrink-0">
          {/* Hamburger — mobile only */}
          <button
            className="md:hidden mr-3 p-2 text-on-surface-variant hover:text-on-surface transition-colors flex-shrink-0"
            onClick={() => setSidebarOpen(true)}
          >
            <span className="material-symbols-outlined text-[24px]">menu</span>
          </button>

          {/* Search */}
          <div className="flex items-center flex-1 max-w-xl" ref={searchRef}>
            <div className="relative w-full group">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[20px]">
                {searching ? 'hourglass_empty' : 'search'}
              </span>
              <input
                className="w-full bg-surface-container border-none py-2 pl-10 pr-4 text-body-sm font-body-sm
                           text-on-surface placeholder:text-on-surface-variant/40 outline-none
                           focus:ring-1 focus:ring-primary-container transition-all"
                placeholder={`${t('header.search')}  Ctrl+K`}
                value={search}
                onChange={e => handleSearch(e.target.value)}
                onFocus={() => { if (results.length > 0) setDropdownOpen(true); }}
              />

              {/* Search dropdown */}
              {dropdownOpen && results.length > 0 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-surface-container-high border border-outline-variant/20 shadow-2xl z-50 max-h-[420px] overflow-y-auto">
                  {results.map((r, i) => (
                    <button
                      key={`${r.type}-${r.id}-${i}`}
                      onClick={() => handleResultClick(r.url)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-container-highest transition-colors text-left border-b border-outline-variant/5 last:border-0"
                    >
                      <span className="material-symbols-outlined text-on-surface-variant text-[18px] flex-shrink-0">
                        {TYPE_ICONS[r.type] || 'search'}
                      </span>
                      <div className="flex-1 overflow-hidden">
                        <div className="flex items-center gap-2">
                          <span className="font-body-sm text-on-surface text-[13px] truncate">{r.title}</span>
                          {r.status && (
                            <span className="font-label-caps text-[9px] px-1.5 py-0.5" style={{ color: STATUS_COLORS[r.status] || '#888', background: `${STATUS_COLORS[r.status]}22` }}>
                              {r.status}
                            </span>
                          )}
                        </div>
                        <div className="font-label-caps text-[10px] text-on-surface-variant/60 mt-0.5 truncate">{r.subtitle}</div>
                      </div>
                      {r.amount != null && (
                        <span className="font-data-mono text-[11px] text-primary flex-shrink-0">
                          {r.amount.toLocaleString('bg-BG', { maximumFractionDigits: 0 })} {r.currency}
                        </span>
                      )}
                      <span className="font-label-caps text-[9px] text-on-surface-variant/40 flex-shrink-0 ml-1">
                        {TYPE_LABELS[r.type]}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {dropdownOpen && search.length >= 2 && results.length === 0 && !searching && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-surface-container-high border border-outline-variant/20 shadow-2xl z-50 px-4 py-6 text-center">
                  <span className="font-label-caps text-label-caps text-on-surface-variant/50">Няма резултати за „{search}"</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions + Lang + User */}
          <div className="flex items-center gap-6 ml-gutter">
            <div className="flex gap-4">
              <button
                onClick={() => router.push('/alerts')}
                className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors"
                title="Известия"
              >
                notifications
              </button>
              <button
                onClick={() => router.push('/vat')}
                className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors"
                title="ДДС"
              >
                account_balance_wallet
              </button>
              <button
                onClick={() => router.push('/ai')}
                className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors"
                title="AI Асистент"
              >
                help_outline
              </button>
            </div>

            {/* Language toggle */}
            <div className="flex gap-0.5 border border-outline-variant/30 p-0.5">
              <button
                onClick={() => setLang('bg')}
                className={`px-2.5 py-1 font-label-caps text-[10px] transition-colors ${
                  lang === 'bg'
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                БГ
              </button>
              <button
                onClick={() => setLang('en')}
                className={`px-2.5 py-1 font-label-caps text-[10px] transition-colors ${
                  lang === 'en'
                    ? 'bg-primary-container text-on-primary-container'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                EN
              </button>
            </div>

            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-primary-container text-on-primary-container text-[12px] font-bold flex items-center justify-center border border-outline-variant flex-shrink-0">
              {user?.name?.charAt(0).toUpperCase() ?? 'S'}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
