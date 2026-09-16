import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

const root = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/**
 * SWC with decorator metadata: Vitest's default transform emits none, and Nest's DI would then
 * resolve `undefined` in a way that looks like a broken provider (conventions §17.2).
 */
const swcPlugin = (): Plugin =>
  swc.vite({
    tsconfigFile: false,
    module: { type: 'es6' },
    jsc: {
      target: 'es2023',
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true, useDefineForClassFields: false },
      keepClassNames: true,
    },
  }) as Plugin;

/** Workspace packages resolve to source, so `test` needs no build. Exact matches only. */
const alias = [
  { find: /^@wayfare\/contracts$/, replacement: root('./packages/contracts/src/index.ts') },
  { find: /^@wayfare\/contracts\/grpc$/, replacement: root('./packages/contracts/src/grpc.ts') },
  { find: /^@wayfare\/nest-common$/, replacement: root('./packages/nest-common/src/index.ts') },
];

const unit = (name: string, dir: string, include: string[]) => ({
  plugins: [swcPlugin()],
  resolve: { alias },
  test: {
    name: `unit:${name}`,
    root: root(dir),
    include,
    environment: 'node',
    setupFiles: [root('./vitest.setup.ts')],
    env: { OTEL_SDK_DISABLED: 'true' },
  },
});

export default defineConfig({
  test: {
    projects: [
      unit('contracts', './packages/contracts', ['src/**/*.spec.ts']),
      unit('nest-common', './packages/nest-common', ['src/**/*.spec.ts']),
      unit('identity', './services/identity', ['src/**/*.spec.ts']),
      unit('gateway', './services/gateway', ['src/**/*.spec.ts', 'test/e2e/**/*.spec.ts']),
      unit('config', './packages/config', ['markdownlint/**/*.spec.ts']),
      // Repo-wide rules as tests (conventions §17.4); also a named step in pr.yml.
      unit('guards', './packages/config', ['guards/**/*.spec.ts']),
      {
        plugins: [swcPlugin()],
        resolve: { alias },
        test: {
          name: 'integration:identity',
          root: root('./services/identity'),
          include: ['test/integration/**/*.spec.ts', 'test/contract/**/*.spec.ts'],
          environment: 'node',
          globalSetup: ['test/setup/global-setup.ts'],
          setupFiles: [root('./vitest.setup.ts'), 'test/setup/env.ts'],
          env: { OTEL_SDK_DISABLED: 'true' },
          // One database: suites run serially (conventions §17.2).
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
