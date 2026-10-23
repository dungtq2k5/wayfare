'use client';

import dynamic from 'next/dynamic';

/**
 * The patterns and their sample Places, loaded only when the page is opened. NODE_ENV is folded at
 * build time, so a production build drops the import and its sample data altogether.
 */
export const PatternsLoader = dynamic(
  () =>
    process.env.NODE_ENV !== 'production'
      ? import('../../../../patterns/patterns-demo')
      : Promise.resolve(() => null),
  { ssr: false },
);
