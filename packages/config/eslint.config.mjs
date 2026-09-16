// Shared flat ESLint config: style baseline plus the boundary rules from
// development-conventions. Every rule message names the convention it enforces.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const PRISMA_CLIENT_PATTERN = {
  group: ['**/generated/prisma', '**/generated/prisma/*'],
  message:
    'The Prisma client is only used from *.service.ts and prisma.service.ts (conventions §2.1).',
};

const PROCESS_ENV_ALLOWED = [
  '**/env.schema.ts',
  '**/main.ts',
  '**/instrumentation.ts',
  '**/prisma.config.ts',
  '**/vitest.config.mts',
  '**/test/setup/**',
  '**/scripts/**',
];

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
        'no-restricted-syntax': [
          'error',
          {
            selector: "NewExpression[callee.name='RpcException']",
            message: 'Throw through rpcError() from @wayfare/nest-common (conventions §6.4).',
          },
          {
            selector: "MemberExpression[object.name='process'][property.name='env']",
            message:
              'Read configuration through AppConfig; process.env only in env.schema.ts and main.ts (conventions §13).',
          },
        ],
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
            message: 'Read configuration through AppConfig (conventions §13).',
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
      files: ['**/*.controller.ts', '**/*.consumer.ts'],
      rules: {
        'no-restricted-imports': ['error', { patterns: [PRISMA_CLIENT_PATTERN] }],
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
            patterns: [
              {
                group: ['**/dto/**'],
                message: 'A gRPC client returns proto types only — never a DTO (conventions §2.2).',
              },
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
            ],
          },
        ],
      },
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
