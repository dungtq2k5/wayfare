import { status } from '@grpc/grpc-js';
import { Logger } from '@nestjs/common';
import type { ProtoEnumBridge } from '@wayfare/contracts';
import { rpcError } from '../errors/rpc-error';

/**
 * The domain member for a REQUIRED proto enum field, or `INVALID_ARGUMENT` / `VALIDATION_FAILED`
 * with the field's JSON pointer (conventions §6.3). A non-zero value this build does not know is
 * logged at `warn` first — a newer peer is talking to us.
 */
export function requireProtoEnum<D extends string>(
  bridge: ProtoEnumBridge<D, number>,
  value: number | null | undefined,
  path: string,
  logger: Pick<Logger, 'warn'> = new Logger('ProtoEnum'),
): D {
  const member = bridge.fromProto(value);
  if (member !== null) return member;
  if (value !== null && value !== undefined && value !== 0) {
    logger.warn(
      { protoEnum: bridge.name, value, path },
      'unknown proto enum value — is a newer peer talking to us?',
    );
  }
  throw rpcError(status.INVALID_ARGUMENT, 'VALIDATION_FAILED', {
    issues: [{ path, code: 'invalid_value' }],
  });
}
