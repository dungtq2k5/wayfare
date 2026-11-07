// Events, decisions and refusals for the analytics suites.
import type { Metadata } from '@grpc/grpc-js';
import type { RpcException } from '@nestjs/microservices';
import {
  AnalyticsEventType,
  AnalyticsTrigger,
  AudioTier,
  ConsentState,
  ERROR_CODE_METADATA_KEY,
  LEGAL_DOCUMENT_VERSIONS,
  LegalDocument,
  newId,
} from '@wayfare/contracts';
import type { AnalyticsServices } from './services';

export const POLICY = LEGAL_DOCUMENT_VERSIONS[LegalDocument.PRIVACY_POLICY];

/** The error code an RPC refusal carries, or null for anything else. */
export async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    const raw = (error as RpcException).getError?.() as { metadata?: Metadata } | undefined;
    const value = raw?.metadata?.get(ERROR_CODE_METADATA_KEY)[0];
    return typeof value === 'string' ? value : null;
  }
}

/** An id with a current grant. */
export async function consenting(services: AnalyticsServices, at?: Date): Promise<string> {
  const id = newId();
  await services.events.recordConsent(
    { analyticsDeviceId: id, state: ConsentState.GRANTED, policyVersion: POLICY },
    at,
  );
  return id;
}

/** An event as a client sends it. */
export function event(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: newId(),
    sessionId: newId(),
    type: AnalyticsEventType.APP_OPENED,
    occurredAt: new Date().toISOString(),
    ...fields,
  };
}

/** A started narration at a Place. */
export function started(
  placeId: string,
  occurredAt: Date,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return event({
    type: AnalyticsEventType.NARRATION_STARTED,
    placeId,
    trigger: AnalyticsTrigger.GEOFENCE,
    audioTier: AudioTier.T1,
    lang: 'en',
    occurredAt: occurredAt.toISOString(),
    ...fields,
  });
}

/** Posts events for an id, as the gateway forwards them. */
export function ingest(
  services: AnalyticsServices,
  analyticsDeviceId: string,
  events: readonly Record<string, unknown>[],
  now?: Date,
  platform = 'ANDROID',
) {
  return services.events.ingest(
    {
      analyticsDeviceId,
      eventsJson: events.map((sent) => JSON.stringify(sent)),
      platform,
      appVersion: '0.4.1',
    },
    now,
  );
}
