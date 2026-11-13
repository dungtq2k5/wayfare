import { defineConfig } from 'orval';
import type { OpenApiDocument } from 'orval';

interface Operation {
  parameters: { name?: string }[];
  responses: Record<string, unknown>;
}

/**
 * What the client is generated from: the committed document, less what the mutator owns. Every
 * operation lists the `X-Wayfare-Client` header, which `apiFetch` sets once, and every error
 * response, which `ApiError` carries by `code` (api-endpoints-plan §0.4) — thousands of types no
 * caller reads.
 */
const forClient = (document: OpenApiDocument): OpenApiDocument => {
  const paths = (document.paths ?? {}) as Record<string, Record<string, unknown>>;
  const stripped: Record<string, Record<string, unknown>> = {};
  for (const [path, item] of Object.entries(paths)) {
    for (const operation of Object.values(item) as Partial<Operation>[]) {
      if (typeof operation !== 'object') continue;
      operation.parameters = (operation.parameters ?? []).filter(
        (parameter) => parameter.name !== 'X-Wayfare-Client',
      );
      for (const status of Object.keys(operation.responses ?? {})) {
        if (!status.startsWith('2')) delete operation.responses?.[status];
      }
    }
    // The base URL carries `/api/v1`: the app configures it once, per environment.
    stripped[path.replace(/^\/api\/v1/, '')] = item;
  }
  document.paths = stripped;
  return document;
};

/** `AreasController_list_v1` → `areasList`: the hook is `useAreasList`, and the id stays unique. */
const operationName = (operation: { operationId?: string }): string => {
  const [controller = '', method = ''] = (operation.operationId ?? '')
    .replace(/_v\d+$/, '')
    .split('_');
  const base = controller.replace(/Controller$/, '');
  return `${base.charAt(0).toLowerCase()}${base.slice(1)}${method.charAt(0).toUpperCase()}${method.slice(1)}`;
};

export default defineConfig({
  wayfare: {
    hooks: { afterAllFilesWrite: 'node scripts/write-index.mjs' },
    input: { target: './openapi.json', override: { transformer: forClient } },
    output: {
      mode: 'tags-split',
      target: './src/generated/endpoints.ts',
      schemas: './src/generated/model',
      client: 'react-query',
      httpClient: 'fetch',
      clean: true,
      override: {
        operationName,
        // The hooks return the wire's envelope (`{ data, meta? }`), not a status wrapper.
        fetch: { includeHttpResponseReturnType: false },
        mutator: { path: './src/fetch.ts', name: 'apiFetch' },
      },
    },
  },
});
