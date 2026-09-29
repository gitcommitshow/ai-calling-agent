'use client';

/**
 * Re-requests the server-rendered page while calls are still in flight, so a
 * results page left open keeps up with a run. Renders nothing and stops as soon
 * as nothing is live, which keeps an idle page quiet.
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

interface Props {
  /** Whether anything is still running. When false, no requests are made. */
  active: boolean;
  intervalMs?: number;
}

export function LiveRefresh({ active, intervalMs = 5000 }: Props) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);

  return null;
}
