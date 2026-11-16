'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

/**
 * The patterns and their sample Places, loaded only when the page is opened. `DEVELOPMENT`'s
 * flags, read inline (an imported constant is not folded), are folded at build time, so a production build drops the import and its sample data altogether.
 */
// Typed here: the workspace holds two React type packages, and the inferred type names one of them.
export const PatternsLoader: ComponentType = dynamic(
  () =>
    process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEV_TOOLS === '1'
      ? import('../../../../patterns/patterns-demo')
      : Promise.resolve(() => null),
  { ssr: false },
);
