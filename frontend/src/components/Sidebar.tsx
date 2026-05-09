'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/store';
import { useT } from '@/lib/i18n';
import { api } from '@/lib/api';

const navItems = [
  { key: 'nav.dashboard',  href: '/',          icon: 'dashboard',           exact: true },
  { key: 'nav.purchases',  href: '/purchases', icon: 'shopping_cart' },
  { key: 'nav.documents',  href: '/documents', icon: 'auto_awesome' },
  { key: 'nav.invoices',   href: '/invoices',  icon: 'receipt_long' },
  { key: 'nav.projects',   href: '/projects',  icon: 'folder_open' },
  { key: 'nav.clients',    href: '/clients',   icon: 'groups' },
  { key: 'nav.suppliers',  href: '/suppliers', icon: 'local_shipping' },
  { key: 'nav.inventory',  href: '/inventory', icon: 'inventory_2' },
  { key: 'nav.expenses',   href: '/expenses',  icon: 'receipt' },
  { key: 'nav.orders',     href: '/orders',    icon: 'shopping_bag' },
  { key: 'nav.vat',        href: '/vat',            icon: 'account_balance' },
  { key: 'nav.reconciliation', href: '/reconciliation', icon: 'account_tree' },
  { key: 'nav.inbox',          href: '/inbox',           icon: 'inbox' },
  { key: 'nav.alerts',         href: '/alerts',    icon: 'notifications_active' },
  { key: 'nav.ai',         href: '/ai',        icon: 'smart_toy' },
  { key: 'nav.backfill',   href: '/backfill',  icon: 'cloud_sync' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, clearUser } = useAuthStore();
  const t = useT();

  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts-sidebar'],
    queryFn: () => api.get('/alerts?status=ACTIVE&limit=20').then(r => r.data),
    refetchInterval: 60000,
  });
  const alertCount = Array.isArray(alerts) ? alerts.length : 0;

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname?.startsWith(href);

  const handleLogout = () => {
    localStorage.removeItem('token');
    clearUser();
    router.replace('/login');
  };

  return (
    <aside className="h-screen w-72 flex-shrink-0 bg-surface-container-lowest flex flex-col py-gutter px-4 z-50">
      {/* Brand */}
      <div className="mb-10 px-2">
        <h1 className="font-headline text-headline-md font-bold text-primary tracking-tight">
          Studio Botema
        </h1>
        <p className="font-label-caps text-label-caps text-on-surface-variant/60 mt-1">
          Interior Design ERP
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto">
        {navItems.map(({ key, href, icon, exact }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-4 py-3 font-label-caps text-label-caps transition-colors ${
                active
                  ? 'text-primary border-r-2 border-primary'
                  : 'text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] flex-shrink-0">{icon}</span>
              <span className="min-w-0 flex-1 truncate">{t(key)}</span>
              {href === '/alerts' && alertCount > 0 && (
                <span className="ml-auto min-w-5 h-5 px-1 rounded-full bg-error text-on-error text-[10px] font-bold flex items-center justify-center">
                  {alertCount > 9 ? '9+' : alertCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* New Project CTA + Logout */}
      <div className="mt-auto space-y-2 px-0">
        <Link
          href="/projects"
          className="block w-full bg-primary-container text-on-primary-container py-3 font-label-caps text-label-caps text-center hover:opacity-90 transition-opacity"
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
  );
}

