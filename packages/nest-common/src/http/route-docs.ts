import { SetMetadata } from '@nestjs/common';
import { ApiExtension } from '@nestjs/swagger';
import type { ErrorCode } from '@wayfare/contracts';

/**
 * The link from an OpenAPI operation back to its handler, so the post-pass in `setupSwagger` can
 * read the route's metadata when the document is built — never at decoration time, where
 * decorator order would change the answer (conventions §5.7).
 */
export const ROUTE_REF_EXTENSION = 'x-wayfare-route';

/** A documented handler and its controller. */
export interface RouteRef {
  readonly handler: (...args: never[]) => unknown;
  readonly controller: abstract new (...args: never[]) => unknown;
}

const refs = new Map<string, RouteRef>();
const idsByHandler = new WeakMap<object, string>();

/** The route a document's extension value names. */
export function routeRefOf(id: unknown): RouteRef | undefined {
  return typeof id === 'string' ? refs.get(id) : undefined;
}

/** Records the handler once and tags its operation with the id. */
export function DocumentedRoute(): MethodDecorator {
  return (target, key, descriptor) => {
    const handler = descriptor.value as unknown as RouteRef['handler'];
    let id = idsByHandler.get(handler);
    if (id === undefined) {
      id = `route-${refs.size + 1}`;
      idsByHandler.set(handler, id);
      refs.set(id, { handler, controller: target.constructor as RouteRef['controller'] });
      ApiExtension(ROUTE_REF_EXTENSION, id)(target, key, descriptor);
    }
  };
}

/** Metadata keys the post-pass reads. */
export const API_ERROR_CODES = 'wayfare:api-error-codes';
export const API_ENVELOPE = 'wayfare:api-envelope';

/** A route's documented success shape. */
export interface EnvelopeDoc {
  /** The DTO class under `data`, or `null` for a body-less response. */
  readonly model: (abstract new (...args: never[]) => unknown) | null;
  readonly status?: number;
  /** `{ data: T[], meta }` with the shared meta component. */
  readonly list?: 'cursor' | 'page';
  /** `{ data: T[] }`, no meta. */
  readonly array?: true;
  /** `{ data, meta }` with this route's own meta shape. */
  readonly meta?: abstract new (...args: never[]) => unknown;
  /**
   * A body that is not the JSON envelope — `@SkipEnvelope` routes such as an SVG. `model` is then
   * `null` and the body is documented as a string of this media type.
   */
  readonly mediaType?: string;
  readonly description?: string;
  /**
   * Other success answers of the same route, each `{ data }` with its own status and model — a
   * route that answers `200` when the work is done and `202` while it is pending.
   */
  readonly alternatives?: readonly SuccessAlternative[];
}

/** One more documented success status of a route. */
export interface SuccessAlternative {
  readonly status: number;
  readonly model: abstract new (...args: never[]) => unknown;
  readonly description?: string;
}

/** Stores the route-specific error codes; the automatic ones are added by the post-pass. */
export function setApiErrorCodes(codes: readonly ErrorCode[]): MethodDecorator {
  return SetMetadata(API_ERROR_CODES, codes);
}

/** Stores the envelope description. */
export function setApiEnvelope(envelope: EnvelopeDoc): MethodDecorator {
  return SetMetadata(API_ENVELOPE, envelope);
}
