import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SocketEmitter } from './socket-emitter';

describe('SocketEmitter', () => {
  it('publishes a validated frame to the namespace room, and drops an invalid one', () => {
    const published: string[] = [];
    const emitter = new SocketEmitter({
      publish: (channel: string) => {
        published.push(channel);
        return 1;
      },
    });
    emitter.toRoom('job:1', 'jobSubscribed', { jobId: '01990000-0000-7000-8000-000000000001' });
    expect(published).toHaveLength(1);
    expect(published[0]).toContain('/ws');
    emitter.toRoom('job:1', 'jobSubscribed', { jobId: 'not-a-uuid' });
    expect(published).toHaveLength(1);
  });
});

describe('SocketEmitter on a failing Redis', () => {
  it('catches a rejected publish', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const emitter = new SocketEmitter({ publish: () => Promise.reject(new Error('offline')) });
    emitter.toRoom('job:1', 'jobSubscribed', { jobId: '01990000-0000-7000-8000-000000000001' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
