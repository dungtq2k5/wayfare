import type { z } from 'zod';
import { rpcError } from '../errors/rpc-error';

/** RFC 6901 pointer for an issue path. */
function pointer(path: readonly PropertyKey[]): string {
  return path
    .map((segment) => `/${String(segment).replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('');
}

/**
 * Validates a gRPC request at the service edge (conventions §6.3). The gateway validates the
 * same bounds first; this is the service not trusting its caller. A failure is `VALIDATION_FAILED`.
 */
export function parseRpcRequest<Schema extends z.ZodType>(
  schema: Schema,
  request: unknown,
): z.output<Schema> {
  const result = schema.safeParse(request);
  if (result.success) return result.data;
  throw rpcError('VALIDATION_FAILED', {
    issues: result.error.issues.map((issue) => ({ path: pointer(issue.path), code: issue.code })),
  });
}
