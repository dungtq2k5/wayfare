import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels } from '@nestjs/swagger';
import { DocumentedRoute, setApiEnvelope } from './route-docs';
import type { EnvelopeDoc } from './route-docs';

/** Options for `@ApiEnvelope`. */
export type ApiEnvelopeOptions = Omit<EnvelopeDoc, 'model'>;

/**
 * Documents the success body as the wire carries it (conventions §5.7): `{ data }`, `{ data, meta }`
 * for a list, `{ data, meta }` for a route's own `meta`, `{ data: [] }` for `array`, a non-JSON
 * body for `mediaType`, or no body for `null`. The status is resolved when the
 * document is built — `status`, else the handler's `@HttpCode`, else 201 for POST and 200 otherwise.
 */
export function ApiEnvelope(
  model: (abstract new (...args: never[]) => unknown) | null,
  options: ApiEnvelopeOptions = {},
): MethodDecorator {
  const decorators: MethodDecorator[] = [setApiEnvelope({ model, ...options }), DocumentedRoute()];
  if (model !== null) decorators.push(ApiExtraModels(model));
  if (options.meta !== undefined) decorators.push(ApiExtraModels(options.meta));
  return applyDecorators(...decorators);
}
