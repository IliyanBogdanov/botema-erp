import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';

const inter = Inter({ subsets: ['latin', 'cyrillic'] });

export const metadata: Metadata = {
  title: 'Studio Botema ERP',
  description: 'Управление на Studio Botema ЕООД',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Botema ERP' },
};

export const viewport: Viewport = {
  themeColor: '#0a84ff',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers><AppShell>{children}</AppShell></Providers>
      </body>
    </html>
  );
}
