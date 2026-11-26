import { ConsentState } from '@wayfare/contracts';
import { analyticsGrpc } from '@wayfare/contracts/grpc';
import { describe, expect, it, vi } from 'vitest';
import type { EventsService } from './events.service';
import { EventsGrpcController } from './events-grpc.controller';

function controller() {
  const events = {
    recordConsent: vi.fn(() => Promise.resolve()),
    ingest: vi.fn(() => Promise.resolve({ accepted: 1 })),
  };
  return { events, grpc: new EventsGrpcController(events as unknown as EventsService) };
}

describe('the tourist’s analytics writes over gRPC', () => {
  it('records a consent in the domain’s terms', async () => {
    const { events, grpc } = controller();
    await expect(
      grpc.recordConsent({
        analyticsDeviceId: 'a1',
        state: analyticsGrpc.ConsentState.CONSENT_STATE_WITHDRAWN,
        policyVersion: '2026-09-01',
      }),
    ).resolves.toEqual({});
    expect(events.recordConsent).toHaveBeenCalledWith({
      analyticsDeviceId: 'a1',
      state: ConsentState.WITHDRAWN,
      policyVersion: '2026-09-01',
    });
  });

  it('refuses a consent with no state, before recording anything', async () => {
    const { events, grpc } = controller();
    await expect(
      grpc.recordConsent({
        analyticsDeviceId: 'a1',
        state: analyticsGrpc.ConsentState.CONSENT_STATE_UNSPECIFIED,
        policyVersion: 'v',
      }),
    ).rejects.toThrow();
    expect(events.recordConsent).not.toHaveBeenCalled();
  });

  it('hands a batch of events to ingestion as it came', async () => {
    const { events, grpc } = controller();
    const request = { analyticsDeviceId: 'a1', events: [] } as never;
    await expect(grpc.ingestEvents(request)).resolves.toEqual({ accepted: 1 });
    expect(events.ingest).toHaveBeenCalledWith(request);
  });
});
