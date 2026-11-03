'use client';

import type { AreaResponseDto } from '@wayfare/api-client';

/** The area pack's style for the page's theme: its dark flavour when the page is dark. */
export function areaStyle(area: Pick<AreaResponseDto, 'mapPack'> | null): string | null {
  const pack = area?.mapPack ?? null;
  if (pack === null) return null;
  const dark =
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
  return dark && pack.styleDark !== null ? pack.styleDark : pack.style;
}
