'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

/**
 * The patterns and their sample Places, loaded only when the page is opened. NODE_ENV is folded at
 * build time, so a production build drops the import and its sample data altogether.
 */
// Typed here: the workspace holds two React type packages, and the inferred type names one of them.
export const PatternsLoader: ComponentType = dynamic(
  () =>
    process.env.NODE_ENV !== 'production'
      ? import('../../../../patterns/patterns-demo')
      : Promise.resolve(() => null),
  { ssr: false },
);
