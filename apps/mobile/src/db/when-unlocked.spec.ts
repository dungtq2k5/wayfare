import { describe, expect, it } from 'vitest';
import { whenUnlocked } from './when-unlocked';

const noWait = () => Promise.resolve();
const locked = new Error(
  "Call to function 'NativeDatabase.execAsync' has been rejected.\n→ Caused by: database is locked",
);

describe('whenUnlocked', () => {
  it('asks again while another write holds the lock, then goes ahead', async () => {
    let calls = 0;
    const result = await whenUnlocked(() => {
      calls += 1;
      return calls < 3 ? Promise.reject(locked) : Promise.resolve('done');
    }, noWait);
    expect(result).toBe('done');
    expect(calls).toBe(3);
  });

  it('gives up after its tries, and never retries any other failure', async () => {
    let calls = 0;
    await expect(
      whenUnlocked(() => {
        calls += 1;
        return Promise.reject(locked);
      }, noWait),
    ).rejects.toBe(locked);
    expect(calls).toBe(8);
    const other = new Error('no such table');
    calls = 0;
    await expect(
      whenUnlocked(() => {
        calls += 1;
        return Promise.reject(other);
      }, noWait),
    ).rejects.toBe(other);
    expect(calls).toBe(1);
  });
});
