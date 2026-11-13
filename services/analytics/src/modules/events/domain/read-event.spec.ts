import { describe, expect, it } from 'vitest';
import { readEvent } from './read-event';

const event = (fields: Record<string, unknown>) =>
  JSON.stringify({
    id: '7c6f0a54-3d1e-4b0a-9c1f-1d2e3f4a5b6c',
    sessionId: '8c6f0a54-3d1e-4b0a-9c1f-1d2e3f4a5b6c',
    occurredAt: '2026-11-07T10:00:00.000Z',
    ...fields,
  });

describe('one event read on its own', () => {
  it('reads a valid event, and drops a malformed one', () => {
    expect('event' in readEvent(event({ type: 'APP_OPENED' }))).toBe(true);
    expect(readEvent('{not json')).toEqual({ dropped: 'malformed' });
    expect(readEvent(event({ type: 'PLACE_OPENED' }))).toEqual({ dropped: 'malformed' });
  });

  it('drops a voucher view while vouchers aren’t sold, and reads it once they are (ADR 0066)', () => {
    expect(readEvent(event({ type: 'VOUCHER_VIEWED' }))).toEqual({ dropped: 'deferred' });
    expect('event' in readEvent(event({ type: 'VOUCHER_VIEWED' }), true)).toBe(true);
  });
});
