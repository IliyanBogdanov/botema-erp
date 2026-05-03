'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, FileText, ShoppingCart, Package,
  FolderOpen, Users, Receipt, Mail, Bot, LogOut, Truck
} from 'lucide-react';
import { useAuthStore } from '@/lib/store';

const navItems = [
  { label: 'Дашборд',    href: '/',          icon: LayoutDashboard, exact: true },
  { label: 'Фактури',    href: '/invoices',  icon: FileText },
  { label: 'Доставки',   href: '/purchases', icon: ShoppingCart },
  { label: 'Склад',      href: '/inventory', icon: Package },
  { label: 'Проекти',    href: '/projects',  icon: FolderOpen },
  { label: 'Клиенти',    href: '/clients',    icon: Users },
  { label: 'Доставчици', href: '/suppliers',  icon: Truck },
  { label: 'Разходи',    href: '/expenses',  icon: Receipt },
  { label: 'Документи',  href: '/documents', icon: Mail },
  { label: 'AI Асистент',href: '/ai',        icon: Bot },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, clearUser } = useAuthStore();

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return pathname === href;
    return pathname?.startsWith(href);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    clearUser();
    router.replace('/login');
  };

  return (
    <aside className="w-56 flex-shrink-0 bg-[#111113] border-r border-[#27272a] flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-[#27272a] flex items-center gap-2.5">
        <svg width="26" height="26" viewBox="0 0 32 32" fill="none" style={{ flexShrink: 0 }}>
          <rect x="1" y="1" width="30" height="30" rx="7" stroke="#e4e4e7" strokeWidth="1.5" opacity="0.9"/>
          <path d="M10 9h8a4 4 0 0 1 0 8h-8V9z M10 15h9a4 4 0 0 1 0 8h-9v-8z"
            stroke="#e4e4e7" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>
        </svg>
        <div>
          <div className="text-sm font-bold text-white leading-tight">Studio Botema</div>
          <div className="text-[9px] text-[#52525b] font-semibold uppercase tracking-widest">ERP System</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {navItems.map(({ label, href, icon: Icon, exact }) => (
          <Link
            key={href}
            href={href}
            className={`nav-item ${isActive(href, exact) ? 'active' : ''}`}
          >
            <Icon size={16} className="flex-shrink-0" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      {/* User */}
      <div className="p-3 border-t border-[#27272a]">
        {user && (
          <div className="mb-2 px-2">
            <div className="text-xs font-semibold text-[#e4e4e7] truncate">{user.name}</div>
            <div className="text-[10px] text-[#52525b] truncate">{user.email}</div>
          </div>
        )}
        <button
          onClick={handleLogout}
          className="nav-item w-full text-[#ff453a] hover:text-[#ff453a] hover:bg-[rgba(255,69,58,0.1)]"
        >
          <LogOut size={15} />
          <span>Изход</span>
        </button>
      </div>
    </aside>
  );
}
