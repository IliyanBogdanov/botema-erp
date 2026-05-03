'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

export default function LoginPage() {
  const router = useRouter();
  const { setUser } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('token', data.token);
      setUser(data.user);
      router.push('/');
    } catch (err: any) {
      const msg = err.response?.data?.message;
      if (err.response?.status === 401) {
        setError('Грешен имейл или парола.');
      } else if (msg) {
        setError(msg);
      } else {
        setError('Възникна грешка. Моля, опитайте отново.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#0a84ff] mb-4">
            <span className="text-2xl font-black text-white">B</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white">Studio Botema ERP</h1>
          <p className="text-sm text-[#71717a] mt-1">Вход в системата</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">
                Имейл
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@botema.bg"
                className="input"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#71717a] uppercase tracking-wider mb-1.5">
                Парола
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="input"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="bg-[rgba(255,69,58,0.1)] border border-[rgba(255,69,58,0.3)] rounded-lg px-3 py-2.5">
                <p className="text-[#ff453a] text-sm font-medium">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Влизане...' : 'Вход'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#52525b] mt-6">
          Studio Botema ЕООД © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
