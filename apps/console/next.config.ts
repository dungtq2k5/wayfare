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
};

export default config;
