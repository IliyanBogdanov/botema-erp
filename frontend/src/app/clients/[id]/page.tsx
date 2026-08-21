'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Клиенти вече живеят в /counterparties. Стар клиентски ID не се превежда
// автоматично тук (легacy Client таблицата е safety net, не е активна) —
// пращаме към списъка вместо счупен линк.
export default function ClientDetailRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/counterparties?type=CLIENT'); }, [router]);
  return null;
}
