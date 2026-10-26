import { describe, expect, it } from 'vitest';
import {
  InputRefusedError,
  isUnreachable,
  NoProviderAnsweredError,
  ProviderChain,
  ProviderTimeoutError,
  redact,
} from './provider-chain';

interface Named {
  readonly name: string;
}

function chain(names: string[], clock: { now: number }) {
  return new ProviderChain<Named>(
    'translation',
    names.map((name) => ({ name })),
    {
      threshold: 3,
      cooldownMs: 60_000,
      timeoutMs: 50,
      now: () => clock.now,
    },
  );
}

const all = () => true;

describe('ProviderChain', () => {
  it('answers from the first provider that works, in order', async () => {
    const clock = { now: 0 };
    const providers = chain(['a', 'b'], clock);
    const answer = await providers.run(all, (p) =>
      p.name === 'a' ? Promise.reject(new Error('503')) : Promise.resolve('ok'),
    );
    expect(answer).toEqual({ result: 'ok', provider: { name: 'b' } });
  });

  it('skips providers that are not eligible', async () => {
    const providers = chain(['a', 'b'], { now: 0 });
    const answer = await providers.run(
      (p) => p.name === 'b',
      () => Promise.resolve('ok'),
    );
    expect(answer.provider.name).toBe('b');
    await expect(
      providers.run(
        () => false,
        () => Promise.resolve('x'),
      ),
    ).rejects.toThrow(/no translation provider is available/);
  });

  it('opens the breaker after the threshold, and closes it after the cooldown', async () => {
    const clock = { now: 0 };
    const providers = chain(['a', 'b'], clock);
    const calls: string[] = [];
    const call = (p: Named) => {
      calls.push(p.name);
      return p.name === 'a' ? Promise.reject(new Error('down')) : Promise.resolve('ok');
    };
    for (let i = 0; i < 3; i++) await providers.run(all, call);
    expect(providers.states()[0]).toMatchObject({ breaker: 'open', errorRate: 1, recentCalls: 3 });
    calls.length = 0;
    await providers.run(all, call);
    expect(calls).toEqual(['b']);
    clock.now += 60_000;
    calls.length = 0;
    await providers.run(all, call);
    expect(calls).toEqual(['a', 'b']);
    // One more failure after the cooldown opens it again.
    expect(providers.states()[0]!.breaker).toBe('open');
  });

  it('says since when a provider is down, through reopenings, until it answers', async () => {
    const clock = { now: 1_000 };
    const providers = chain(['a', 'b'], clock);
    let up = false;
    const call = (p: Named) =>
      p.name === 'a' && !up ? Promise.reject(new Error('down')) : Promise.resolve('ok');
    for (let i = 0; i < 3; i++) await providers.run(all, call);
    expect(providers.states()[0]!.downSince).toEqual(new Date(1_000));
    expect(providers.states()[1]!.downSince).toBeNull();
    clock.now += 60_000;
    await providers.run(all, call);
    expect(providers.states()[0]!.downSince).toEqual(new Date(1_000));
    clock.now += 60_000;
    up = true;
    await providers.run(all, call);
    expect(providers.states()[0]).toMatchObject({ breaker: 'closed', downSince: null });
  });

  it('counts an empty result and a timeout as failures', async () => {
    const providers = chain(['a', 'b'], { now: 0 });
    await expect(
      providers.run(all, (p) =>
        p.name === 'a' ? Promise.resolve('  ') : new Promise<string>(() => undefined),
      ),
    ).rejects.toThrow(/a: empty result; b: timed out after 50 ms/);
  });

  it('does not fail over on a refused input', async () => {
    const providers = chain(['a', 'b'], { now: 0 });
    const calls: string[] = [];
    await expect(
      providers.run(all, (p) => {
        calls.push(p.name);
        return Promise.reject(new InputRefusedError('sentence too long'));
      }),
    ).rejects.toBeInstanceOf(InputRefusedError);
    expect(calls).toEqual(['a']);
    expect(providers.states()[0]!.consecutiveFailures).toBe(0);
  });

  it('reports every provider when all fail', async () => {
    const providers = chain(['a'], { now: 0 });
    await expect(providers.run(all, () => Promise.reject(new Error('x\nbody')))).rejects.toThrow(
      NoProviderAnsweredError,
    );
  });
});

describe('redact', () => {
  it('keeps a message on one short line', () => {
    expect(redact(new Error('[\n  {\n    "code": "invalid"\n  }\n]'))).toBe(
      '[ { "code": "invalid" } ]',
    );
    expect(redact(new Error('x'.repeat(500)))).toHaveLength(200);
  });
});

/** Edge's WebSocket failure with no network: the code sits on the cause. */
const offline = () =>
  new Error('Edge TTS WebSocket error: getaddrinfo EAI_AGAIN speech.platform.bing.com', {
    cause: Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' }),
  });

describe('a provider that cannot be reached', () => {
  it('is a network code on the error or its cause, or the chain timing out', () => {
    expect(isUnreachable(offline())).toBe(true);
    expect(isUnreachable(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(true);
    expect(isUnreachable(new ProviderTimeoutError(50))).toBe(true);
    expect(isUnreachable(new Error('503 Service Unavailable'))).toBe(false);
  });

  it('makes the chain unreachable only when every provider was', async () => {
    const clock = { now: 0 };
    const providers = chain(['a', 'b'], clock);
    const both = providers.run(all, () => Promise.reject(offline()));
    await expect(both).rejects.toMatchObject({ unreachable: true });
    const mixed = providers.run(all, (p) =>
      Promise.reject(p.name === 'a' ? offline() : new Error('bad answer')),
    );
    await expect(mixed).rejects.toMatchObject({ unreachable: false });
  });

  it('counts a provider cooling down by why it last failed', async () => {
    const clock = { now: 0 };
    const providers = chain(['a'], clock);
    for (let i = 0; i < 3; i += 1) {
      await providers.run(all, () => Promise.reject(offline())).catch(() => undefined);
    }
    const cooling = providers.run(all, () => Promise.resolve('never called'));
    await expect(cooling).rejects.toBeInstanceOf(NoProviderAnsweredError);
    await expect(cooling).rejects.toMatchObject({ unreachable: true });

    const failing = chain(['a'], clock);
    for (let i = 0; i < 3; i += 1) {
      await failing.run(all, () => Promise.reject(new Error('500'))).catch(() => undefined);
    }
    await expect(failing.run(all, () => Promise.resolve('x'))).rejects.toMatchObject({
      unreachable: false,
    });
  });

  it('is not unreachable when no provider fits the call at all', async () => {
    const providers = chain(['a'], { now: 0 });
    await expect(
      providers.run(
        () => false,
        () => Promise.resolve('x'),
      ),
    ).rejects.toMatchObject({ unreachable: false });
  });
});
