import { JetStreamApiCodes, JetStreamApiError, StorageType } from '@nats-io/jetstream';
import type { JetStreamManager, StreamConfig, StreamInfo } from '@nats-io/jetstream';
import { nanos } from '@nats-io/transport-node';
import { JETSTREAM_STREAMS } from '@wayfare/contracts';
import type { StreamDefinition, StreamName } from '@wayfare/contracts';

/** Thrown at boot when a stream exists with a configuration other than its single definition. */
export class StreamConfigMismatchError extends Error {
  constructor(name: string, differences: string[]) {
    super(`Stream ${name} exists with a different configuration: ${differences.join('; ')}`);
    this.name = 'StreamConfigMismatchError';
  }
}

/** The JetStream config for a declared stream. */
export function toStreamConfig(
  definition: StreamDefinition,
): Partial<StreamConfig> & { name: string } {
  return {
    name: definition.name,
    subjects: [...definition.subjects],
    max_age: nanos(definition.maxAgeMs),
    duplicate_window: nanos(definition.duplicateWindowMs),
    storage: StorageType.File,
  };
}

/**
 * Creates each missing stream and verifies each existing one — never updates (api-endpoints-plan §10).
 * Called by publishers and consumers alike, so a publish is never lost to a stream nobody declared.
 */
export async function ensureStreams(
  jsm: JetStreamManager,
  names: readonly StreamName[],
): Promise<void> {
  for (const name of names) {
    const definition = JETSTREAM_STREAMS[name];
    const wanted = toStreamConfig(definition);
    let info: StreamInfo | null = null;
    try {
      info = await jsm.streams.info(name);
    } catch (error) {
      if (!(error instanceof JetStreamApiError && error.code === JetStreamApiCodes.StreamNotFound))
        throw error;
    }
    if (info === null) {
      try {
        await jsm.streams.add(wanted);
        continue;
      } catch (error) {
        // Another service created it between our read and our add; verify theirs instead.
        info = await jsm.streams.info(name).catch(() => {
          throw error;
        });
      }
    }
    const differences = diffStream(definition, info.config);
    if (differences.length > 0) throw new StreamConfigMismatchError(name, differences);
  }
}

/** Human-readable differences between a definition and a live stream config. */
export function diffStream(definition: StreamDefinition, actual: StreamConfig): string[] {
  const differences: string[] = [];
  const wantSubjects = [...definition.subjects].sort().join(',');
  const haveSubjects = [...(actual.subjects ?? [])].sort().join(',');
  if (wantSubjects !== haveSubjects) differences.push(`subjects ${haveSubjects} ≠ ${wantSubjects}`);
  if (actual.max_age !== nanos(definition.maxAgeMs))
    differences.push(`max_age ${actual.max_age} ≠ ${nanos(definition.maxAgeMs)}`);
  if (actual.duplicate_window !== nanos(definition.duplicateWindowMs)) {
    differences.push(
      `duplicate_window ${actual.duplicate_window} ≠ ${nanos(definition.duplicateWindowMs)}`,
    );
  }
  if (actual.storage !== StorageType.File) differences.push(`storage ${actual.storage} ≠ file`);
  return differences;
}
