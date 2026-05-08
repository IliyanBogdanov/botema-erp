'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { useAuthStore } from '@/lib/store';

const pageTitles: Record<string, string> = {
  '/':           'Executive Dashboard',
  '/purchases':  'Purchases Ledger',
  '/documents':  'AI Document Center',
  '/invoices':   'Invoices',
  '/projects':   'Projects',
  '/clients':    'Counterparties',
  '/suppliers':  'Suppliers',
  '/inventory':  'Inventory',
  '/expenses':   'Expenses',
  '/alerts':     'Alerts',
  '/ai':         'AI Assistant',
  '/backfill':   'Drive Backfill',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user } = useAuthStore();
  const isAuthPage = pathname?.startsWith('/login');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isAuthPage) {
      const token = localStorage.getItem('token');
      if (!token) router.replace('/login');
    }
  }, [pathname]);

  if (isAuthPage) return <>{children}</>;

  const pageTitle = Object.entries(pageTitles).find(([k]) =>
    k === '/' ? pathname === '/' : pathname?.startsWith(k)
  )?.[1] ?? 'Studio Botema ERP';

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 px-gutter flex items-center justify-between bg-surface-dim border-b border-outline-variant/10 flex-shrink-0">
          {/* Search */}
          <div className="flex items-center flex-1 max-w-xl">
            <div className="relative w-full group">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50 text-[20px]">
                search
              </span>
              <input
                className="w-full bg-surface-container border-none py-2 pl-10 pr-4 text-body-sm font-body-sm
                           text-on-surface placeholder:text-on-surface-variant/40 outline-none
                           focus:ring-1 focus:ring-primary-container transition-all"
                placeholder="Search invoices, projects, suppliers…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Actions + User */}
          <div className="flex items-center gap-6 ml-gutter">
            <div className="flex gap-4">
              <button className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors">
                notifications
              </button>
              <button className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors">
                account_balance_wallet
              </button>
              <button className="material-symbols-outlined text-on-surface-variant hover:text-primary transition-colors">
                help_outline
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
