'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Клиенти и Доставчици вече живеят на едно място — /counterparties.
export default function SuppliersRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/counterparties?type=SUPPLIER'); }, [router]);
  return null;
}
