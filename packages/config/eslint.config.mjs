// Shared flat ESLint config: style baseline plus the boundary rules from
// development-conventions. Every rule message names the convention it enforces.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const PRISMA_CLIENT_PATTERN = {
  group: ['**/generated/prisma', '**/generated/prisma/*'],
  message:
    'The Prisma client is only used from *.service.ts and prisma.service.ts (conventions §2.1).',
};

const TESTING_ENTRY_PATTERN = {
  group: ['@wayfare/*/testing'],
  message: 'Test helpers are for specs, test/ and scripts/ only (conventions §17).',
};

/** Vendor SDKs, imported only by their adapter file (conventions §11.5). */
const VENDOR_SDK_PATHS = [
  'resend',
  'nodemailer',
  '@google-cloud/storage',
  'sharp',
  '@google-cloud/translate',
  '@google-cloud/text-to-speech',
  'msedge-tts',
  'google-translate-api-x',
  'stripe',
].map((name) => ({
  name,
  message: `Only the provider adapter under src/providers/ imports ${name} (conventions §11.5).`,
}));

/** Where the provider adapters live (conventions §2.4). */
const PROVIDER_ADAPTERS = ['services/*/src/providers/**', 'packages/nest-common/src/providers/**'];

/** Where the testing entry points may be imported. */
const TESTING_ALLOWED = ['**/*.spec.ts', '**/test/**', '**/scripts/**', '**/prisma/seed/**'];

const PROCESS_ENV_ALLOWED = [
  '**/instrumentation.ts',
  '**/prisma.config.ts',
  '**/vitest.config.mts',
  '**/test/setup/**',
  // Reads OPENAPI_WRITE: the switch between comparing the spec and writing it (pnpm api:generate).
  'services/gateway/test/e2e/openapi-emit.e2e.spec.ts',
  // Reads I18N_TYPES_WRITE: the same switch for the generated ICU argument types (pnpm i18n:types).
  'packages/i18n/src/generated-types.spec.ts',
  '**/scripts/**',
  '**/prisma/seed/**',
];

const RPC_EXCEPTION_SELECTOR = {
  selector: "NewExpression[callee.name='RpcException']",
  message: 'Throw through rpcError() from @wayfare/nest-common (conventions §6.4).',
};

const PROCESS_ENV_SELECTOR = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    'Read configuration through the injected ConfigService; process.env only in instrumentation.ts, prisma.config.ts, scripts/ and test/setup/ (conventions §13).',
};

/** Hermes has no ES2023 array-by-copy methods; the shared packages and the app run on it. */
const HERMES_SELECTOR = {
  selector: 'CallExpression[callee.property.name=/^(toSorted|toReversed|toSpliced)$/]',
  message:
    'Hermes lacks toSorted/toReversed/toSpliced, and the mobile app runs this code: use [...xs].sort(compare) or [...xs].reverse() (conventions §3.3).',
};

/**
 * Builds the Wayfare ESLint config.
 * @param {{ tsconfigRootDir: string }} options
 */
export function wayfareConfig({ tsconfigRootDir }) {
  return tseslint.config(
    {
      ignores: [
        '**/dist/**',
        '**/generated/**',
        '**/coverage/**',
        '**/node_modules/**',
        'docs/**',
        '**/*.d.ts',
        // Continuous Native Generation: written by `expo prebuild`, never by hand.
        'apps/mobile/android/**',
      ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.node },
        parserOptions: {
          projectService: {
            allowDefaultProject: [
              '*.mjs',
              '*.mts',
              '*.js',
              'vitest.setup.ts',
              'packages/config/scripts/*.mjs',
            ],
          },
          tsconfigRootDir,
          // Decorator-aware, so consistent-type-imports never turns an injected class into
          // `import type` — its metadata would become Object and Nest DI would resolve undefined (ADR 0058).
          emitDecoratorMetadata: true,
          experimentalDecorators: true,
        },
      },
      rules: {
        // A bare sort() compares UTF-16 code units after converting to string — wrong for numbers and
        // host-independent only by accident for strings. Machine strings pass compareStrings (conventions §3.3).
        '@typescript-eslint/require-array-sort-compare': ['error', { ignoreStringArrays: false }],
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/no-extraneous-class': 'off',
        'no-restricted-properties': [
          'error',
          {
            object: 'Math',
            property: 'random',
            message: 'Use generateToken()/generateCode() — never Math.random (conventions §9.2).',
          },
        ],
        'no-restricted-syntax': ['error', RPC_EXCEPTION_SELECTOR, PROCESS_ENV_SELECTOR],
      },
    },
    {
      files: ['**/*.mjs', '**/*.js'],
      ...tseslint.configs.disableTypeChecked,
    },
    {
      // new RpcException is allowed only inside nest-common, which implements rpcError().
      files: ['packages/nest-common/**'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[object.name='process'][property.name='env']",
            message:
              'Read configuration through the injected ConfigService; process.env only in instrumentation.ts, prisma.config.ts, scripts/ and test/setup/ (conventions §13).',
          },
        ],
      },
    },
    {
      files: PROCESS_ENV_ALLOWED,
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: "NewExpression[callee.name='RpcException']",
            message: 'Throw through rpcError() from @wayfare/nest-common (conventions §6.4).',
          },
        ],
      },
    },
    {
      files: ['**/*.ts'],
      ignores: TESTING_ALLOWED,
      rules: {
        'no-restricted-imports': [
          'error',
          { paths: VENDOR_SDK_PATHS, patterns: [TESTING_ENTRY_PATTERN] },
        ],
      },
    },
    {
      files: PROVIDER_ADAPTERS,
      rules: {
        'no-restricted-imports': ['error', { patterns: [TESTING_ENTRY_PATTERN] }],
      },
    },
    {
      files: ['**/*.controller.ts', '**/*.consumer.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          { paths: VENDOR_SDK_PATHS, patterns: [PRISMA_CLIENT_PATTERN, TESTING_ENTRY_PATTERN] },
        ],
      },
    },
    {
      // The gateway documents with @ApiEnvelope and validates with @ZodSerializerDto (conventions §5.7).
      files: ['services/gateway/**/*.ts'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'nestjs-zod',
                importNames: ['ZodResponse'],
                message:
                  'Use @ApiEnvelope for the document and @ZodSerializerDto for validation (conventions §5.7).',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['**/*.mapper.ts'],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          { patterns: [{ ...PRISMA_CLIENT_PATTERN, allowTypeImports: true }] },
        ],
      },
    },
    {
      files: ['**/*-grpc.client.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: VENDOR_SDK_PATHS,
            patterns: [
              {
                group: ['**/dto/**'],
                message: 'A gRPC client returns proto types only — never a DTO (conventions §2.2).',
              },
              TESTING_ENTRY_PATTERN,
            ],
          },
        ],
      },
    },
    {
      files: ['packages/contracts/**', 'packages/core/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  'node:*',
                  'fs',
                  'path',
                  'crypto',
                  'os',
                  'child_process',
                  '@nestjs/*',
                  'react',
                  'react-native',
                  'expo',
                  'expo-*',
                ],
                message:
                  'Client-shared packages import nothing Node-only or framework-bound (conventions §3.2, §3.3).',
              },
              TESTING_ENTRY_PATTERN,
            ],
          },
        ],
      },
    },
    {
      // packages/core takes time and randomness as arguments (conventions §3.2): an import ban
      // cannot see a global, so Date/timers/fetch/Math.random are banned here too.
      files: ['packages/core/src/**'],
      ignores: ['**/*.spec.ts'],
      rules: {
        'no-restricted-globals': [
          'error',
          {
            name: 'Date',
            message: 'packages/core takes time and randomness as arguments (conventions §3.2).',
          },
          {
            name: 'setTimeout',
            message: 'packages/core takes time and randomness as arguments (conventions §3.2).',
          },
          {
            name: 'setInterval',
            message: 'packages/core takes time and randomness as arguments (conventions §3.2).',
          },
          {
            name: 'fetch',
            message: 'packages/core takes time and randomness as arguments (conventions §3.2).',
          },
        ],
        'no-restricted-properties': [
          'error',
          {
            object: 'Math',
            property: 'random',
            message: 'packages/core takes time and randomness as arguments (conventions §3.2).',
          },
        ],
      },
    },
    {
      // The mobile app runs these packages on Hermes (specs run in Node and are exempt). A block
      // replaces the same rule key from earlier blocks, so every selector in force here is repeated.
      files: [
        'packages/contracts/src/**',
        'packages/core/src/**',
        'packages/i18n/src/**',
        'packages/api-client/src/**',
      ],
      ignores: ['**/*.spec.ts', '**/generated/**'],
      rules: {
        'no-restricted-syntax': [
          'error',
          RPC_EXCEPTION_SELECTOR,
          PROCESS_ENV_SELECTOR,
          HERMES_SELECTOR,
        ],
      },
    },
    {
      // The app reads its EXPO_PUBLIC_ values through process.env, in src/env.ts alone (conventions §12.4).
      files: ['apps/mobile/**'],
      ignores: ['**/*.spec.ts', '**/*.spec.tsx', 'apps/mobile/src/env.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          RPC_EXCEPTION_SELECTOR,
          {
            ...PROCESS_ENV_SELECTOR,
            message:
              'Read EXPO_PUBLIC_ values through src/env.ts, the only file that touches process.env (conventions §12.4).',
          },
          HERMES_SELECTOR,
        ],
      },
    },
    {
      files: ['apps/mobile/src/env.ts'],
      rules: { 'no-restricted-syntax': ['error', RPC_EXCEPTION_SELECTOR, HERMES_SELECTOR] },
    },
    {
      // React Native: hooks rules, and the globals Hermes provides.
      files: ['apps/mobile/**/*.{ts,tsx}'],
      plugins: { 'react-hooks': reactHooks },
      languageOptions: { globals: { __DEV__: 'readonly' } },
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'error',
      },
    },
    {
      // Metro, Babel and Tailwind load these as CommonJS.
      files: ['apps/mobile/*.js'],
      rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    {
      // Every translation goes through useTourist(), whose keys and ICU arguments are type-checked.
      // This block replaces the base no-restricted-imports, so its vendor and testing bans are repeated.
      files: ['apps/mobile/**/*.{ts,tsx}'],
      ignores: [...TESTING_ALLOWED, 'apps/mobile/src/i18n/**'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              ...VENDOR_SDK_PATHS,
              ...['i18next', 'react-i18next'].map((name) => ({
                name,
                message: `Translate through useTourist() from src/i18n; only src/i18n imports ${name}.`,
              })),
            ],
            patterns: [TESTING_ENTRY_PATTERN],
          },
        ],
      },
    },
    {
      // Developer tools beside the engine they replay; never part of the package's dist (conventions §3.2).
      files: ['packages/core/scripts/**'],
      rules: { 'no-restricted-imports': 'off' },
    },
    {
      files: ['**/*.spec.ts', '**/test/**'],
      rules: {
        '@typescript-eslint/unbound-method': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
      },
    },
  );
}
