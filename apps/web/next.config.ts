import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';
import { DIST_DIR } from './src/env';

const config: NextConfig = {
  // packages/ui ships its source; the web app compiles it.
  transpilePackages: ['@wayfare/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  // No generated AGENTS.md in the app: the repo's own instructions apply.
  agentRules: false,
  // Next's corner indicator draws itself into every screen baseline.
  devIndicators: false,
  // The screen baselines' web app runs beside the developer's own: a build folder of its own.
  distDir: DIST_DIR,
  // Always defined, so every build folds it: an unset NEXT_PUBLIC_ value is left to a runtime
  // lookup, and the development aids it guards (src/env.ts) would stay in a production build.
  env: { NEXT_PUBLIC_DEV_TOOLS: process.env.NEXT_PUBLIC_DEV_TOOLS ?? '' },
  images: { unoptimized: true },
};

/**
 * The service worker (K11) through Serwist, which hooks into webpack: `next build --webpack`.
 * Development keeps Turbopack and has no worker — it exists only in a production build.
 */
const withSerwist = withSerwistInit({
  swSrc: 'src/sw.ts',
  swDest: 'public/sw.js',
  additionalPrecacheEntries: [
    { url: '/offline', revision: process.env.NEXT_PUBLIC_APP_VERSION ?? '1' },
  ],
  reloadOnOnline: false,
});

// Only a production build gets the plugin's webpack config: Turbopack in development refuses one.
// The screens' build (`NEXT_PUBLIC_DEV_TOOLS=1`) has no worker either: a worker answering the
// app's requests would hide them from the specs' `page.route`.
export default process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_DEV_TOOLS !== '1'
  ? withSerwist(config)
  : config;
