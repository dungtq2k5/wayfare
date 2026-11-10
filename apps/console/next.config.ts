import type { NextConfig } from 'next';
import { DIST_DIR } from './src/env';

const config: NextConfig = {
  // packages/ui ships its source; the console compiles it.
  transpilePackages: ['@wayfare/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  // No generated AGENTS.md in the app: the repo's own instructions apply.
  agentRules: false,
  // Next's corner indicator draws itself into every screen baseline.
  devIndicators: false,
  // The screen baselines' console runs beside the developer's own (e2e/README.md): a build folder
  // of its own, so the two development servers never share one.
  distDir: DIST_DIR,
  // Always defined, so every build folds it: an unset NEXT_PUBLIC_ value is left to a runtime
  // lookup, and the development aids it guards (src/env.ts) would stay in a production build.
  env: { NEXT_PUBLIC_DEV_TOOLS: process.env.NEXT_PUBLIC_DEV_TOOLS ?? '' },
};

export default config;
