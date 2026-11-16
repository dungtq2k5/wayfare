import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

/** Metadata key read by `ResponseEnvelopeInterceptor`. */
export const SKIP_ENVELOPE = 'wayfare:skip-envelope';

/**
 * Serves a route's body unwrapped — the ops routes, whose shape is the same on every service and
 * whose probes read only the status code (api-endpoints-plan §13).
 */
export const SkipEnvelope = (): CustomDecorator<string> => SetMetadata(SKIP_ENVELOPE, true);
