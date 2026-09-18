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
  {
    find: /^@wayfare\/contracts\/grpc$/,
    replacement: root('./packages/contracts/src/grpc/index.ts'),
  },
  {
    find: /^@wayfare\/contracts\/testing$/,
    replacement: root('./packages/contracts/src/testing/index.ts'),
  },
  { find: /^@wayfare\/core$/, replacement: root('./packages/core/src/index.ts') },
  { find: /^@wayfare\/i18n$/, replacement: root('./packages/i18n/src/index.ts') },
  { find: /^@wayfare\/nest-common$/, replacement: root('./packages/nest-common/src/index.ts') },
  {
    find: /^@wayfare\/nest-common\/storage$/,
    replacement: root('./packages/nest-common/src/providers/storage/index.ts'),
  },
  {
    find: /^@wayfare\/nest-common\/testing$/,
    replacement: root('./packages/nest-common/src/testing/index.ts'),
  },
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
    // Measured only where a bar is set: packages/core (conventions §17.3). `pnpm test:coverage`.
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/index.ts'],
      thresholds: { lines: 90, branches: 90 },
    },
    projects: [
      unit('contracts', './packages/contracts', ['src/**/*.spec.ts']),
      unit('core', './packages/core', ['src/**/*.spec.ts']),
      unit('nest-common', './packages/nest-common', ['src/**/*.spec.ts']),
      unit('i18n', './packages/i18n', ['src/**/*.spec.ts']),
      unit('identity', './services/identity', ['src/**/*.spec.ts']),
      unit('catalog', './services/catalog', ['src/**/*.spec.ts']),
      unit('narration', './services/narration', ['src/**/*.spec.ts']),
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
      {
        plugins: [swcPlugin()],
        resolve: { alias },
        test: {
          name: 'integration:catalog',
          root: root('./services/catalog'),
          include: ['test/integration/**/*.spec.ts'],
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
      {
        plugins: [swcPlugin()],
        resolve: { alias },
        test: {
          name: 'integration:narration',
          root: root('./services/narration'),
          include: ['test/integration/**/*.spec.ts'],
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
