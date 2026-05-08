import type { Metadata, Viewport } from 'next';
import { Inter, Playfair_Display } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/Providers';
import { AppShell } from '@/components/AppShell';

const inter = Inter({ subsets: ['latin', 'cyrillic'], variable: '--font-inter' });
const playfair = Playfair_Display({ subsets: ['latin'], weight: ['500', '600'], variable: '--font-playfair' });

export const metadata: Metadata = {
  title: 'Studio Botema ERP',
  description: 'Управление на Studio Botema ЕООД',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'Botema ERP' },
};

export const viewport: Viewport = {
  themeColor: '#3e90ff',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=block"
          rel="stylesheet"
        />
      </head>
      <body className={`${inter.variable} ${playfair.variable} ${inter.className}`}>
        <Providers><AppShell>{children}</AppShell></Providers>
      </body>
    </html>
  );
}
