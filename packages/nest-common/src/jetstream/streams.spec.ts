import { JetStreamApiCodes, JetStreamApiError, StorageType } from '@nats-io/jetstream';
import type { JetStreamManager, StreamConfig } from '@nats-io/jetstream';
import { JETSTREAM_STREAMS } from '@wayfare/contracts';
import { describe, expect, it, vi } from 'vitest';
import { diffStream, ensureStreams, StreamConfigMismatchError, toStreamConfig } from './streams';

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

describe('ensuring the streams at boot (api-endpoints-plan §10)', () => {
  const notFound = () =>
    new JetStreamApiError({
      code: 404,
      err_code: JetStreamApiCodes.StreamNotFound,
      description: 'stream not found',
    });
  const audit = toStreamConfig(JETSTREAM_STREAMS.AUDIT) as StreamConfig;
  const manager = (streams: { info: ReturnType<typeof vi.fn>; add?: ReturnType<typeof vi.fn> }) =>
    ({
      streams: { add: vi.fn(() => Promise.resolve()), ...streams },
    }) as unknown as JetStreamManager & {
      streams: { add: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> };
    };

  it('creates a missing stream from its definition', async () => {
    const jsm = manager({ info: vi.fn().mockRejectedValue(notFound()) });
    await ensureStreams(jsm, ['AUDIT']);
    expect(jsm.streams.add).toHaveBeenCalledWith(audit);
  });

  it('verifies an existing stream, never updating it, and refuses one that drifted', async () => {
    const jsm = manager({ info: vi.fn().mockResolvedValue({ config: audit }) });
    await ensureStreams(jsm, ['AUDIT']);
    expect(jsm.streams.add).not.toHaveBeenCalled();
    const drifted = manager({
      info: vi.fn().mockResolvedValue({ config: { ...audit, duplicate_window: 1 } }),
    });
    await expect(ensureStreams(drifted, ['AUDIT'])).rejects.toThrow(StreamConfigMismatchError);
    await expect(ensureStreams(drifted, ['AUDIT'])).rejects.toThrow(/duplicate_window/);
  });

  it('verifies the stream another service created between the read and the add', async () => {
    const info = vi.fn().mockRejectedValueOnce(notFound()).mockResolvedValueOnce({ config: audit });
    const jsm = manager({
      info,
      add: vi.fn().mockRejectedValue(new Error('stream name already in use')),
    });
    await expect(ensureStreams(jsm, ['AUDIT'])).resolves.toBeUndefined();
    expect(info).toHaveBeenCalledTimes(2);
  });

  it('lets the add’s failure through when no stream is there after all, and any other read failure', async () => {
    const refused = new Error('insufficient resources');
    const jsm = manager({
      info: vi.fn().mockRejectedValue(notFound()),
      add: vi.fn().mockRejectedValue(refused),
    });
    await expect(ensureStreams(jsm, ['AUDIT'])).rejects.toBe(refused);
    const down = new Error('timeout');
    await expect(
      ensureStreams(manager({ info: vi.fn().mockRejectedValue(down) }), ['AUDIT']),
    ).rejects.toBe(down);
  });

  it('reads a stream with no subjects as subscribing to none', () => {
    expect(
      diffStream(JETSTREAM_STREAMS.AUDIT, {
        ...audit,
        subjects: undefined,
      } as unknown as StreamConfig)[0],
    ).toMatch(/^subjects {2}≠/);
  });
});
