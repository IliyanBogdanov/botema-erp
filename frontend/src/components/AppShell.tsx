'use client';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthPage = pathname?.startsWith('/login');

  useEffect(() => {
    if (!isAuthPage) {
      const token = localStorage.getItem('token');
      if (!token) router.replace('/login');
    }
  }, [pathname]);

  if (isAuthPage) return <>{children}</>;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto bg-[#09090b]">{children}</main>
    </div>
  );
}
