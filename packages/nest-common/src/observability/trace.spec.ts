import { ROOT_CONTEXT } from '@opentelemetry/api';
import { describe, expect, it } from 'vitest';
import {
  contextFromTraceparent,
  currentTraceparent,
  headerGetter,
  headerSetter,
  requestIdOfActiveTrace,
} from './trace';

describe('trace helpers', () => {
  it('starts from the root without a traceparent', () => {
    expect(contextFromTraceparent(null)).toBe(ROOT_CONTEXT);
    expect(contextFromTraceparent('')).toBe(ROOT_CONTEXT);
    expect(contextFromTraceparent(undefined)).toBe(ROOT_CONTEXT);
  });

  it('has no traceparent and a fresh random request id when nothing is traced', () => {
    expect(currentTraceparent()).toBeNull();
    const id = requestIdOfActiveTrace();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(requestIdOfActiveTrace()).not.toBe(id);
  });

  it('reads and writes propagation fields on NATS headers, an empty one as absent', () => {
    const values = new Map<string, string>();
    const bag = {
      get: (key: string) => values.get(key) ?? '',
      set: (key: string, value: string) => void values.set(key, value),
      keys: () => [...values.keys()],
    };
    headerSetter.set(bag, 'traceparent', 't');
    expect(headerGetter.get(bag, 'traceparent')).toBe('t');
    expect(headerGetter.get(bag, 'tracestate')).toBeUndefined();
    expect(headerGetter.keys(bag)).toEqual(['traceparent']);
  });
});
