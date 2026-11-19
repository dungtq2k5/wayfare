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
  // Specs reach the client's transport, not its 700 generated files.
  { find: /^@wayfare\/api-client$/, replacement: root('./packages/api-client/src/fetch.ts') },
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

/**
 * The source the coverage figure counts: every app's, service's and package's `src`, and the
 * mobile app's routes and its native modules' bindings, which live beside it. Each tier's run
 * adds the files no test loaded, at 0 %, looking from each project's root, so the globs are
 * relative to it.
 */
export const coverageInclude = ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}', 'modules/*/src/**/*.ts'];

/**
 * What isn't counted, each for its reason: nothing is left out for being hard to test.
 * SonarCloud's `sonar.coverage.exclusions` names the same globs, so no braces here
 * (packages/config/guards/coverage-exclusions.spec.ts).
 */
export const coverageExclude = [
  // Not ours.
  '**/node_modules/**',
  // The tests themselves.
  '**/*.spec.ts',
  '**/*.spec.tsx',
  // Generated: the gRPC code, the i18n argument types, the API client's operations.
  '**/generated/**',
  // Bootstrap: a process's start and its tracing, run by the stack, not by a test.
  '**/src/main.ts',
  '**/src/instrumentation.ts',
  // Nest's module wiring: declarations, no logic.
  '**/*.module.ts',
  // Operators' scripts (seeding the system rows, recovery), run by hand.
  '**/src/scripts/**',
  // Test support: shared fixtures and fakes the specs import, and core's GPS trace generator.
  '**/src/testing/**',
  'packages/core/src/geofence/trace-generator.ts',
  // Type-only.
  '**/*.d.ts',
];

/**
 * Each package's floor, lines and branches, from its measured figure rounded down. A floor is
 * raised, never lowered, until every package is at 90 % and one bar holds the project. Checked
 * on the merged report alone (`pnpm coverage:report`): one tier by itself is short of it.
 */
const coverageFloors = {
  'apps/console/src/**': { lines: 7, branches: 6 },
  'apps/mobile/{src,app,modules}/**': { lines: 21, branches: 18 },
  'apps/web/src/**': { lines: 9, branches: 10 },
  'packages/api-client/src/**': { lines: 73, branches: 64 },
  'packages/contracts/src/**': { lines: 99, branches: 91 },
  'packages/core/src/**': { lines: 99, branches: 96 },
  'packages/i18n/src/**': { lines: 94, branches: 85 },
  'packages/nest-common/src/**': { lines: 86, branches: 82 },
  'packages/ui/src/**': { lines: 16, branches: 21 },
  'services/analytics/src/**': { lines: 86, branches: 78 },
  'services/billing/src/**': { lines: 86, branches: 75 },
  'services/catalog/src/**': { lines: 91, branches: 83 },
  'services/gateway/src/**': { lines: 88, branches: 64 },
  'services/identity/src/**': { lines: 93, branches: 85 },
  'services/narration/src/**': { lines: 87, branches: 77 },
};

export default defineConfig({
  test: {
    // Both tiers write a blob report (`test:coverage`, `test:integration:coverage`); the merge
    // makes one lcov, which SonarCloud reads in CI's `sonar` job (architecture §12).
    coverage: {
      provider: 'v8',
      include: coverageInclude,
      exclude: coverageExclude,
      thresholds: process.argv.includes('--merge-reports') ? coverageFloors : {},
      reporter: ['text-summary', 'json-summary', 'html', 'lcov'],
    },
    projects: [
      unit('contracts', './packages/contracts', ['src/**/*.spec.ts']),
      unit('core', './packages/core', ['src/**/*.spec.ts']),
      unit('nest-common', './packages/nest-common', ['src/**/*.spec.ts']),
      unit('i18n', './packages/i18n', ['src/**/*.spec.ts']),
      unit('mobile', './apps/mobile', ['src/**/*.spec.ts']),
      unit('console', './apps/console', ['src/**/*.spec.ts', 'e2e/screens/*.spec.ts']),
      unit('web', './apps/web', ['src/**/*.spec.ts', 'e2e/screens/*.spec.ts']),
      unit('ui', './packages/ui', ['src/**/*.spec.ts']),
      unit('design-tokens', './packages/design-tokens', ['src/**/*.spec.ts']),
      unit('api-client', './packages/api-client', ['src/**/*.spec.ts']),
      unit('identity', './services/identity', ['src/**/*.spec.ts']),
      unit('catalog', './services/catalog', ['src/**/*.spec.ts', 'prisma/seed/**/*.spec.ts']),
      unit('narration', './services/narration', ['src/**/*.spec.ts']),
      unit('billing', './services/billing', ['src/**/*.spec.ts']),
      unit('analytics', './services/analytics', ['src/**/*.spec.ts']),
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
          setupFiles: [
            root('./vitest.setup.ts'),
            root('./vitest.integration.setup.ts'),
            'test/setup/env.ts',
          ],
          // @google-cloud/storage's request stream (teeny-request@11.0.1) puts more than ten listeners
          // on one short-lived PassThrough per call: not ours, not a leak, and it fills the run's
          // output. Quiet in the integration runs only; the services keep the warning.
          execArgv: ['--disable-warning=MaxListenersExceededWarning'],
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
          setupFiles: [
            root('./vitest.setup.ts'),
            root('./vitest.integration.setup.ts'),
            'test/setup/env.ts',
          ],
          // @google-cloud/storage's request stream (teeny-request@11.0.1) puts more than ten listeners
          // on one short-lived PassThrough per call: not ours, not a leak, and it fills the run's
          // output. Quiet in the integration runs only; the services keep the warning.
          execArgv: ['--disable-warning=MaxListenersExceededWarning'],
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
          setupFiles: [
            root('./vitest.setup.ts'),
            root('./vitest.integration.setup.ts'),
            'test/setup/env.ts',
          ],
          // @google-cloud/storage's request stream (teeny-request@11.0.1) puts more than ten listeners
          // on one short-lived PassThrough per call: not ours, not a leak, and it fills the run's
          // output. Quiet in the integration runs only; the services keep the warning.
          execArgv: ['--disable-warning=MaxListenersExceededWarning'],
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
          name: 'integration:billing',
          root: root('./services/billing'),
          include: ['test/integration/**/*.spec.ts'],
          environment: 'node',
          globalSetup: ['test/setup/global-setup.ts'],
          setupFiles: [
            root('./vitest.setup.ts'),
            root('./vitest.integration.setup.ts'),
            'test/setup/env.ts',
          ],
          // @google-cloud/storage's request stream (teeny-request@11.0.1) puts more than ten listeners
          // on one short-lived PassThrough per call: not ours, not a leak, and it fills the run's
          // output. Quiet in the integration runs only; the services keep the warning.
          execArgv: ['--disable-warning=MaxListenersExceededWarning'],
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
          name: 'integration:analytics',
          root: root('./services/analytics'),
          include: ['test/integration/**/*.spec.ts'],
          environment: 'node',
          globalSetup: ['test/setup/global-setup.ts'],
          setupFiles: [
            root('./vitest.setup.ts'),
            root('./vitest.integration.setup.ts'),
            'test/setup/env.ts',
          ],
          // @google-cloud/storage's request stream (teeny-request@11.0.1) puts more than ten listeners
          // on one short-lived PassThrough per call: not ours, not a leak, and it fills the run's
          // output. Quiet in the integration runs only; the services keep the warning.
          execArgv: ['--disable-warning=MaxListenersExceededWarning'],
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
