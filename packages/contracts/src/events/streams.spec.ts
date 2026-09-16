import { describe, expect, it } from 'vitest';
import { dlqSubject, durableName, JETSTREAM_STREAMS } from './streams';

describe('stream naming', () => {
  it('derives durable names from service and subject', () => {
    expect(durableName('identity', 'audit.record')).toBe('identity-audit-record');
  });

  it('puts dead letters under dlq.<service>.<consumer>', () => {
    expect(dlqSubject('identity', 'identity-audit-record')).toBe(
      'dlq.identity.identity-audit-record',
    );
  });

  it('keeps dead letters longer than events', () => {
    expect(JETSTREAM_STREAMS.DLQ.maxAgeMs).toBeGreaterThan(JETSTREAM_STREAMS.AUDIT.maxAgeMs);
    expect(JETSTREAM_STREAMS.DLQ.subjects).toContain('dlq.>');
  });
});
