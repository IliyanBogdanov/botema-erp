import axios from 'axios';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL?.trim() ||
  (typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : 'http://localhost:3001');

export const api = axios.create({
  baseURL: `${apiBaseUrl}/api`,
});

api.interceptors.request.use(config => {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ─── Formatters ───────────────────────────────────────────────────────────────
export const BGN_PER_EUR = 1.95583;
// Fallback market rate; matches the backend fallback in lib/fx.js
export const USD_PER_EUR = 1.14;

/** Convert an amount in the given currency to EUR (BGN by the fixed peg, USD by fallback rate) */
export const amountToEur = (n: number | string | null | undefined, currency?: string | null) => {
  const amt = Number(n) || 0;
  const cur = String(currency || 'EUR').toUpperCase();
  if (cur === 'BGN') return amt / BGN_PER_EUR;
  if (cur === 'USD') return amt / USD_PER_EUR;
  return amt;
};

/** Format a number as EUR currency */
export const fmt = (n: number | string | null | undefined, currency = 'EUR') =>
  new Intl.NumberFormat('bg-BG', { style: 'currency', currency, minimumFractionDigits: 2 }).format(Number(n) || 0);

/** Convert BGN amount to EUR and format */
export const fmtBgn = (n: number | string | null | undefined) =>
  fmt(Number(n || 0) / BGN_PER_EUR, 'EUR');

export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit', year: 'numeric' });

export const fmtShort = (d: string | Date) =>
  new Date(d).toLocaleDateString('bg-BG', { day: '2-digit', month: 'short' });

// ─── Status helpers ───────────────────────────────────────────────────────────
export const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  PAID:      { label: '✓ Платено',   color: '#30d158', bg: 'rgba(48,209,88,0.15)' },
  PENDING:   { label: '⏳ Чака',      color: '#ff9f0a', bg: 'rgba(255,159,10,0.15)' },
  OVERDUE:   { label: '⚠ Просрочено', color: '#ff453a', bg: 'rgba(255,69,58,0.15)' },
  CANCELLED: { label: '✗ Анулирана', color: '#636366', bg: 'rgba(99,99,102,0.15)' },
  ACTIVE:    { label: '● Активен',   color: '#0a84ff', bg: 'rgba(10,132,255,0.15)' },
  COMPLETED: { label: '✓ Приключен', color: '#636366', bg: 'rgba(99,99,102,0.15)' },
  ON_HOLD:   { label: '⏸ Пауза',     color: '#ff9f0a', bg: 'rgba(255,159,10,0.15)' },
};
