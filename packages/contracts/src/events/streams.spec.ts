import { describe, expect, it } from 'vitest';
import { DLQ_MAX_AGE_MS, EVENT_STREAM_MAX_AGE_MS } from '../limits/retention';
import {
  dlqSubject,
  durableName,
  JETSTREAM_STREAMS,
  STREAM_NAMES,
  streamsForSubject,
  subjectMatches,
} from './streams';

describe('stream naming', () => {
  it('derives durable names from service and subject', () => {
    expect(durableName('identity', 'audit.record')).toBe('identity-audit-record');
  });

  it('puts dead letters under dlq.<service>.<consumer>', () => {
    expect(dlqSubject('identity', 'identity-audit-record')).toBe(
      'dlq.identity.identity-audit-record',
    );
  });
});

describe('stream definitions', () => {
  it('has one stream per publisher, the two every-service subjects, and the dead letters', () => {
    expect(STREAM_NAMES).toEqual([
      'IDENTITY',
      'CATALOG',
      'NARRATION',
      'BILLING',
      'AUDIT',
      'NOTIFICATION',
      'DLQ',
    ]);
  });

  it('keeps dead letters longer than events', () => {
    expect(JETSTREAM_STREAMS.DLQ.maxAgeMs).toBe(DLQ_MAX_AGE_MS);
    expect(JETSTREAM_STREAMS.AUDIT.maxAgeMs).toBe(EVENT_STREAM_MAX_AGE_MS);
    expect(DLQ_MAX_AGE_MS).toBeGreaterThan(EVENT_STREAM_MAX_AGE_MS);
    expect(JETSTREAM_STREAMS.DLQ.subjects).toEqual(['dlq.>']);
  });

  it('routes a dead letter to DLQ only', () => {
    expect(streamsForSubject('dlq.identity.identity-audit-record')).toEqual(['DLQ']);
  });
});

describe('subjectMatches', () => {
  it.each([
    ['identity.>', 'identity.user.erased', true],
    ['identity.>', 'identity', false],
    ['identity.>', 'identityx.user.erased', false],
    ['audit.record', 'audit.record', true],
    ['audit.record', 'audit.record.x', false],
    ['a.*.c', 'a.b.c', true],
    ['a.*.c', 'a.b.d', false],
  ])('%s matches %s: %s', (filter, subject, expected) => {
    expect(subjectMatches(filter, subject)).toBe(expected);
  });
});
