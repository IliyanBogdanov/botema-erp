'use client';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';

const primaryGroups = [
  {
    label: 'Operations',
    items: [
      { key: 'nav.dashboard', href: '/', icon: 'dashboard', exact: true },
      { key: 'nav.purchases', href: '/purchases', icon: 'shopping_cart' },
      { key: 'nav.documents', href: '/documents', icon: 'auto_awesome' },
      { key: 'nav.projects', href: '/projects', icon: 'folder_open' },
    ],
  },
  {
    label: 'Finance',
    items: [
      { key: 'nav.invoices', href: '/invoices', icon: 'receipt_long' },
      { key: 'nav.vat', href: '/vat', icon: 'account_balance' },
      { key: 'nav.finance', href: '/finance', icon: 'bar_chart' },
      { key: 'nav.reconciliation', href: '/reconciliation', icon: 'account_tree' },
    ],
  },
  {
    label: 'Studio',
    items: [
      { key: 'nav.clients', href: '/clients', icon: 'groups' },
      { key: 'nav.counterparties', href: '/counterparties', icon: 'corporate_fare' },
      { key: 'nav.suppliers', href: '/suppliers', icon: 'local_shipping' },
    ],
  },
];

const advancedItems = [
  { key: 'nav.issuedDocs', href: '/issued-docs', icon: 'edit_document' },
  { key: 'nav.expenses', href: '/expenses', icon: 'receipt' },
  { key: 'nav.aged', href: '/aged-debtors', icon: 'pending_actions' },
  { key: 'nav.inbox', href: '/inbox', icon: 'inbox' },
  { key: 'nav.alerts', href: '/alerts', icon: 'notifications_active' },
  { key: 'nav.ai', href: '/ai', icon: 'smart_toy' },
  { key: 'nav.backfill', href: '/backfill', icon: 'cloud_sync' },
  { key: 'nav.settings', href: '/settings', icon: 'settings' },
];

interface SidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearUser } = useAuthStore();
  const t = useT();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const { data: alertData } = useQuery({
    queryKey: ['alerts-count'],
    queryFn: () => api.get('/alerts/count').then(r => r.data),
    refetchInterval: 5 * 60 * 1000,
    staleTime: 5 * 60 * 1000,
  });
  const alertCount = alertData?.count ?? 0;

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname?.startsWith(href);

  const handleLogout = () => {
    localStorage.removeItem('token');
    clearUser();
    router.replace('/login');
  };

  const handleNavClick = () => {
    onClose?.();
  };

  const renderLink = ({ key, href, icon, exact }: { key: string; href: string; icon: string; exact?: boolean }) => {
    const active = isActive(href, exact);
    return (
      <Link
        key={href}
        href={href}
        onClick={handleNavClick}
        className={`flex items-center gap-3 px-3 py-2 rounded-md font-label-caps text-label-caps transition-all duration-150 ${
          active
            ? 'bg-primary-container/15 text-primary'
            : 'text-on-surface-variant/70 hover:text-on-surface hover:bg-surface-container-high'
        }`}
      >
        <span className={`material-symbols-outlined text-[18px] flex-shrink-0 ${active ? 'text-primary' : ''}`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1 truncate">{t(key)}</span>
        {href === '/alerts' && alertCount > 0 && (
          <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-error text-on-error text-[10px] font-bold flex items-center justify-center">
            {alertCount > 9 ? '9+' : alertCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <>
      {open !== undefined && (
        <div
          className={`fixed inset-0 bg-black/60 z-40 md:hidden transition-opacity duration-300 ${
            open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
          onClick={onClose}
        />
      )}

      <aside
        className={`
          h-screen w-72 flex-shrink-0 bg-surface-container-lowest flex flex-col py-gutter px-4 z-50
          ${open !== undefined
            ? `fixed top-0 left-0 transition-transform duration-300 md:static md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`
            : 'relative'
          }
        `}
      >
        <div className="mb-8 px-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="flex-shrink-0 opacity-90">
              <rect x="1" y="1" width="30" height="30" rx="7" stroke="#aac7ff" strokeWidth="1.5" opacity="0.9" />
              <path d="M10 9h8a4 4 0 0 1 0 8h-8V9z M10 15h9a4 4 0 0 1 0 8h-9v-8z" stroke="#aac7ff" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
            </svg>
            <div>
              <h1 className="font-display text-[16px] font-semibold text-on-surface tracking-tight leading-none">
                Studio Botema
              </h1>
              <p className="font-label-caps text-[9px] text-on-surface-variant/50 mt-1 tracking-[0.18em] uppercase">
                Interior Design ERP
              </p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden p-2 text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto -mx-1 px-1 space-y-4">
          {primaryGroups.map((group) => (
            <div key={group.label}>
              <p className="font-label-caps text-[9px] tracking-[0.18em] text-on-surface-variant/35 uppercase px-3 mb-1">
                {group.label}
              </p>
              {group.items.map(renderLink)}
            </div>
          ))}

          <div>
            <button
              type="button"
              onClick={() => setAdvancedOpen(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md font-label-caps text-[10px] tracking-[0.18em] uppercase text-on-surface-variant/45 hover:text-on-surface hover:bg-surface-container-high transition-colors"
            >
              <span>Advanced</span>
              <span className="material-symbols-outlined text-[18px]">
                {advancedOpen ? 'expand_less' : 'expand_more'}
              </span>
            </button>
            {advancedOpen && (
              <div className="mt-1 space-y-1">
                {advancedItems.map(renderLink)}
              </div>
            )}
          </div>
        </nav>

        <div className="mt-auto space-y-2 px-0 pt-4 border-t border-outline-variant/10">
          <Link
            href="/projects"
            onClick={handleNavClick}
            className="block w-full bg-primary-container text-on-primary-container py-2.5 rounded-md font-label-caps text-label-caps text-center hover:opacity-90 transition-opacity"
          >
            {t('nav.newProject')}
          </Link>

          {user && (
            <div className="px-2 pt-3 border-t border-outline-variant/10">
              <div className="text-on-surface font-body-sm text-body-sm truncate">{user.name}</div>
              <div className="text-on-surface-variant/60 font-label-caps text-[10px] truncate">{user.email}</div>
              <button
                onClick={handleLogout}
                className="mt-2 flex items-center gap-2 px-0 py-2 font-label-caps text-label-caps text-error hover:text-error/80 transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">logout</span>
                <span>{t('nav.signOut')}</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
