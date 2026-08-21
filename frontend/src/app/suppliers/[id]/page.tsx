'use client';
import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';

// /api/suppliers already served Counterparty rows before this merge, so the
// id in the URL is already a real Counterparty id — safe to redirect directly.
export default function SupplierDetailRedirect() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  useEffect(() => { router.replace(`/counterparties/${id}`); }, [router, id]);
  return null;
}
