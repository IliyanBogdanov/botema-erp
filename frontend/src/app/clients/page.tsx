'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Клиенти и Доставчици вече живеят на едно място — /counterparties.
export default function ClientsRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/counterparties?type=CLIENT'); }, [router]);
  return null;
}
