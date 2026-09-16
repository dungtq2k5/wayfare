import { randomBytes } from 'node:crypto';
import { context, propagation, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import type { Context, TextMapGetter, TextMapSetter } from '@opentelemetry/api';

/** The tracer for spans Wayfare creates by hand — the NATS hops auto-instrumentation cannot see. */
export const wayfareTracer = trace.getTracer('wayfare');

/** The W3C `traceparent` of the active context, or null when nothing is being traced. */
export function currentTraceparent(): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent ?? null;
}

/** A context whose parent is the given `traceparent` — or the root context when there is none. */
export function contextFromTraceparent(traceparent: string | null | undefined): Context {
  if (!traceparent) return ROOT_CONTEXT;
  return propagation.extract(ROOT_CONTEXT, { traceparent });
}

/** Header carrier accessors for anything with `get(key)` / `set(key, value)` — NATS headers. */
export interface HeaderBag {
  get(key: string): string;
  set(key: string, value: string): void;
  keys(): string[];
}

/** Reads propagation fields from NATS headers. */
export const headerGetter: TextMapGetter<HeaderBag> = {
  get: (carrier, key) => carrier.get(key) || undefined,
  keys: (carrier) => carrier.keys(),
};

/** Writes propagation fields into NATS headers. */
export const headerSetter: TextMapSetter<HeaderBag> = {
  set: (carrier, key, value) => carrier.set(key, value),
};

/** The response's `requestId`: the active trace id (api-endpoints-plan §0.4), or a fresh random id when untraced. */
export function requestIdOfActiveTrace(): string {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (spanContext && trace.isSpanContextValid(spanContext)) return spanContext.traceId;
  return randomBytes(16).toString('hex');
}
