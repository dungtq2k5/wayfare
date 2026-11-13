// Small builders shared by the narration integration suites.
import { LocalizationTargetType, SynthesisTrigger } from '@wayfare/contracts';
import type {
  CATALOG_PLACE_CONTENT_CHANGED,
  EventPayload,
  SynthesisJobStatus,
} from '@wayfare/contracts';
import { localizationTargetTypeProto } from '@wayfare/contracts/grpc';
import type { narrationGrpc } from '@wayfare/contracts/grpc';
import { placeContentChangedFixture } from '@wayfare/contracts/testing';
import type { AccountContext } from '@wayfare/nest-common';
import { buildAccountContext, buildDeviceContext } from '@wayfare/nest-common/testing';
import type { PrismaService } from '../../src/modules/prisma/prisma.service';

/** The place-content consumer's durable name. */
export const PLACE_CONSUMER = 'narration-catalog-place-content-changed';

/** A staff account allowed the monitor. */
export function staff(overrides: Partial<Omit<AccountContext, 'kind'>> = {}): AccountContext {
  return buildAccountContext({
    permissions: ['narration.job.read', 'narration.job.manage'],
    ...overrides,
  });
}

/** A tourist device. */
export const device = () => buildDeviceContext();

/** A `catalog.place.content_changed` payload. */
export function placeChanged(
  placeId: string,
  contentHash: string,
  langs: string[] = ['en', 'zh-Hans', 'ja', 'ko'],
  trigger: SynthesisTrigger.APPROVAL | SynthesisTrigger.CONTENT_CHANGED = SynthesisTrigger.APPROVAL,
): EventPayload<typeof CATALOG_PLACE_CONTENT_CHANGED> {
  return placeContentChangedFixture({ placeId, contentHash, langs, trigger }) as EventPayload<
    typeof CATALOG_PLACE_CONTENT_CHANGED
  >;
}

/** A `CreateManualJob` request for a Place. */
export function manualRequest(
  placeId: string,
  langs: string[],
  includeAudio = true,
): narrationGrpc.CreateManualJobRequest {
  return {
    targetType: localizationTargetTypeProto.toProto(LocalizationTargetType.PLACE),
    targetId: placeId,
    langs,
    includeAudio,
  };
}

/** Every job, oldest first, with its tasks. */
export function jobsOf(prisma: PrismaService, targetId: string) {
  return prisma.synthesisJob.findMany({
    where: { targetId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { tasks: { orderBy: { lang: 'asc' } } },
  });
}

/** One job with its tasks. */
export function jobOf(prisma: PrismaService, jobId: string) {
  return prisma.synthesisJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { tasks: { orderBy: { lang: 'asc' } } },
  });
}

/** The job's status as a domain value. */
export const statusOf = (job: { status: string }) => job.status as SynthesisJobStatus;

/** A failed call's error code, from its trailing metadata. */
export async function errorCode(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (e: unknown) => e,
  );
  const rpc = error as { getError?: () => { metadata: { get(key: string): unknown[] } } };
  if (typeof rpc.getError !== 'function') throw error;
  return String(rpc.getError().metadata.get('wf-error-code')[0]);
}
