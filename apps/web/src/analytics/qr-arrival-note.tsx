'use client';

import { AnalyticsEventType } from '@wayfare/contracts';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { track } from './analytics';
import { markQrArrival } from './qr-arrival';

/**
 * A page the gateway's `/q/` opened (`?via=qr`): a sticker scanned — analytics' `QR_SCANNED`, and
 * the first story's trigger is the QR. The parameter is then dropped from the address the tourist
 * sees or shares.
 */
export function QrArrivalNote({ target }: { target: 'PLACE' | 'TOUR' }) {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (params.get('via') !== 'qr') return;
    markQrArrival();
    track({ type: AnalyticsEventType.QR_SCANNED, target });
    const rest = new URLSearchParams(params);
    rest.delete('via');
    const query = rest.toString();
    router.replace(query === '' ? path : `${path}?${query}`, { scroll: false });
  }, [params, router, path, target]);
  return null;
}
