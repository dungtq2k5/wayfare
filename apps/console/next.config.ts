import type { NextConfig } from 'next';

const config: NextConfig = {
  // packages/ui ships its source; the console compiles it.
  transpilePackages: ['@wayfare/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  // No generated AGENTS.md in the app: the repo's own instructions apply.
  agentRules: false,
};

export default config;
