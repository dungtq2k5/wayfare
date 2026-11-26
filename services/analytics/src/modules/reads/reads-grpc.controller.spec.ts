import { packCallerContext } from '@wayfare/nest-common';
import { buildAccountContext, buildDeviceContext } from '@wayfare/nest-common/testing';
import { describe, expect, it, vi } from 'vitest';
import type { ReadsService } from './reads.service';
import { ReadsGrpcController } from './reads-grpc.controller';

const READS = [
  ['getPlaceDailyStats', 'placeDailyStats'],
  ['getOverview', 'overview'],
  ['getTopPlaces', 'topPlaces'],
  ['getHeatmap', 'heatmap'],
  ['getRuntimeActivity', 'runtimeActivity'],
  ['getCurrentActivity', 'currentActivity'],
] as const;

function controller() {
  const reads = Object.fromEntries(
    READS.map(([, method]) => [method, vi.fn(() => Promise.resolve({ answer: method }))]),
  ) as unknown as ReadsService & Record<string, ReturnType<typeof vi.fn>>;
  return { reads, grpc: new ReadsGrpcController(reads) };
}

describe('the analytics reads over gRPC', () => {
  it.each(READS)(
    '%s serves an account caller, delegating the request once',
    async (rpc, method) => {
      const { reads, grpc } = controller();
      const request = { range: { fromDay: '2026-11-01', toDay: '2026-11-07' } } as never;
      await expect(grpc[rpc](request, packCallerContext(buildAccountContext()))).resolves.toEqual({
        answer: method,
      });
      expect(reads[method]).toHaveBeenCalledWith(request);
    },
  );

  it.each(READS)('%s refuses a device or no caller: accounts only', (rpc, method) => {
    const { reads, grpc } = controller();
    expect(() => grpc[rpc]({} as never, packCallerContext(buildDeviceContext()))).toThrow();
    expect(() => grpc[rpc]({} as never, undefined)).toThrow();
    expect(reads[method]).not.toHaveBeenCalled();
  });
});
