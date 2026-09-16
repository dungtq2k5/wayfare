import { StorageType } from '@nats-io/jetstream';
import type { StreamConfig } from '@nats-io/jetstream';
import { JETSTREAM_STREAMS } from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import { diffStream, toStreamConfig } from './streams';

describe('stream definitions', () => {
  it('reports no difference for a stream created from its definition', () => {
    const config = toStreamConfig(JETSTREAM_STREAMS.AUDIT) as StreamConfig;
    expect(diffStream(JETSTREAM_STREAMS.AUDIT, config)).toEqual([]);
  });

  it('reports every drifted field of an existing stream', () => {
    const config = {
      ...toStreamConfig(JETSTREAM_STREAMS.AUDIT),
      subjects: ['audit.>'],
      max_age: 1,
      storage: StorageType.Memory,
    } as StreamConfig;
    const differences = diffStream(JETSTREAM_STREAMS.AUDIT, config);
    expect(differences).toHaveLength(3);
    expect(differences.join(' ')).toMatch(/subjects.*max_age.*storage/);
  });
});
