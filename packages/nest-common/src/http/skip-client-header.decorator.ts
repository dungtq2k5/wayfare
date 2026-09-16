import { SetMetadata } from '@nestjs/common';
import type { CustomDecorator } from '@nestjs/common';

/** Metadata key read by `ClientHeaderGuard`. */
export const SKIP_CLIENT_HEADER = 'wayfare:skip-client-header';

/**
 * Exempts a route or controller from `X-Wayfare-Client` — ops probes, and later the provider
 * webhooks and `/q/:publicCode` (conventions §5.3).
 */
export const SkipClientHeader = (): CustomDecorator<string> =>
  SetMetadata(SKIP_CLIENT_HEADER, true);
