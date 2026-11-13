import {
  AnalyticsEventType,
  AnalyticsTrigger,
  AudioTier,
  hasCoordinateField,
} from '@wayfare/contracts';
import { describe, expect, it } from 'vitest';
import {
  AnalyticsClient,
  BACKOFF_FIRST_MS,
  BACKOFF_MAX_MS,
  BATCHES_PER_HOUR,
  PAGEHIDE_MAX_EVENTS,
  QUEUE_MAX_ROWS,
} from './client';
import type { AnalyticsDeps, QueuedEvent, SendResult } from './client';
import { ANALYTICS_ID_MEMORY_MS, ANALYTICS_ID_ROTATION_MS, SESSION_IDLE_MS } from './state';
import type { AnalyticsState } from './state';

const BUILD_VERSION = '2026-09-01';
const PLACE = '01a0b373-d3eb-73c0-bd63-b96a868ab216';
const DAY = 24 * 60 * 60 * 1000;

/** An install in memory: its stored state, its queue, the requests it made, a clock. */
function install(answers: { consent?: () => SendResult; events?: () => SendResult } = {}) {
  let stored: AnalyticsState | null = null;
  let rows: QueuedEvent[] = [];
  const queued: QueuedEvent[] = [];
  let counter = 0;
  const clock = { now: Date.parse('2026-11-07T10:00:00Z') };
  const requests: {
    route: 'consent' | 'events';
    body: Record<string, unknown>;
    keepalive?: boolean;
  }[] = [];
  const outdated: string[] = [];
  const reported: Error[] = [];
  const fix: { value: { lat: number; lng: number; at: number } | null } = { value: null };
  const deps: AnalyticsDeps = {
    load: () => Promise.resolve(stored),
    save: (state) => {
      stored = state;
      return Promise.resolve();
    },
    queue: {
      add: (row) => {
        rows.push(row);
        queued.push(row);
        return Promise.resolve();
      },
      oldest: (limit) =>
        Promise.resolve(rows.toSorted((a, b) => a.recordedAt - b.recordedAt).slice(0, limit)),
      remove: (ids) => {
        rows = rows.filter((row) => !ids.includes(row.id));
        return Promise.resolve();
      },
      clear: () => {
        rows = [];
        return Promise.resolve();
      },
      count: () => Promise.resolve(rows.length),
      trim: (before, max) => {
        rows = rows
          .filter((row) => row.recordedAt >= before)
          .toSorted((a, b) => a.recordedAt - b.recordedAt)
          .slice(-max);
        return Promise.resolve();
      },
    },
    transport: {
      consent: (body) => {
        requests.push({ route: 'consent', body });
        return Promise.resolve(answers.consent?.() ?? { status: 204 });
      },
      events: (body, options) => {
        requests.push({ route: 'events', body, keepalive: options?.keepalive });
        return Promise.resolve(answers.events?.() ?? { status: 202 });
      },
    },
    newId: () => {
      counter += 1;
      return `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`;
    },
    now: () => clock.now,
    position: () => fix.value,
    language: () => 'en',
    buildPolicyVersion: BUILD_VERSION,
    onPolicyOutdated: (version) => outdated.push(version),
    report: (error) => reported.push(error),
  };
  return {
    deps,
    clock,
    fix,
    requests,
    outdated,
    reported,
    rows: () => rows,
    /** Every event ever queued, sent or not. */
    bodies: () => queued.map((row) => JSON.parse(row.body) as Record<string, unknown>),
    stored: () => stored,
    open: () => AnalyticsClient.open(deps),
  };
}

const started = {
  type: AnalyticsEventType.NARRATION_STARTED,
  narration: { placeId: PLACE, lang: 'ko' },
  trigger: AnalyticsTrigger.TAP,
  audioTier: AudioTier.T1_5,
} as const;

async function allowed(env: ReturnType<typeof install>) {
  const client = await env.open();
  await client.allow();
  env.requests.length = 0;
  return client;
}

describe('consent', () => {
  it('records nothing before a choice, after a no, or while the grant is unanswered', async () => {
    const env = install({ consent: () => ({ status: 'failed' }) });
    const client = await env.open();
    await client.record(started);
    expect(env.rows()).toHaveLength(0);
    await client.allow(); // offline: pending
    expect(client.snapshot()).toMatchObject({ choice: 'GRANTED', counting: false });
    await client.record(started);
    expect(env.rows()).toHaveLength(0);
  });

  it('Allow makes an id, posts the grant at the known version, and counts once accepted', async () => {
    const env = install();
    const client = await env.open();
    await client.allow();
    expect(env.requests).toEqual([
      {
        route: 'consent',
        body: {
          analyticsDeviceId: expect.any(String),
          state: 'GRANTED',
          policyVersion: BUILD_VERSION,
        },
      },
    ]);
    expect(client.snapshot().counting).toBe(true);
  });

  it('a first No thanks posts nothing; turning off later withdraws every remembered id and empties the queue', async () => {
    const first = install();
    const fresh = await first.open();
    await fresh.withdraw();
    expect(first.requests).toHaveLength(0);
    expect(fresh.snapshot().choice).toBe('WITHDRAWN');

    const env = install();
    const client = await allowed(env);
    const firstId = client.snapshot().state.current!.id;
    await client.record(started);
    env.clock.now += ANALYTICS_ID_ROTATION_MS; // rotates at the next event
    await client.record(started);
    const secondId = client.snapshot().state.current!.id;
    expect(secondId).not.toBe(firstId);
    env.requests.length = 0;
    await client.withdraw();
    expect(env.rows()).toHaveLength(0);
    expect(
      env.requests.filter((request) => request.route === 'consent').map((request) => request.body),
    ).toEqual([
      { analyticsDeviceId: firstId, state: 'WITHDRAWN', policyVersion: BUILD_VERSION },
      { analyticsDeviceId: secondId, state: 'WITHDRAWN', policyVersion: BUILD_VERSION },
    ]);
    expect(client.snapshot().state).toMatchObject({ withdrawalsPending: [], remembered: [] });
  });

  it('retries a withdrawal until it’s accepted; turning back on makes a new id', async () => {
    let online = false;
    const env = install({ consent: () => (online ? { status: 204 } : { status: 'failed' }) });
    online = true;
    const client = await allowed(env);
    const old = client.snapshot().state.current!.id;
    online = false;
    await client.withdraw();
    expect(client.snapshot().state.withdrawalsPending).toEqual([old]);
    online = true;
    env.clock.now += BACKOFF_FIRST_MS;
    await client.flush();
    expect(client.snapshot().state.withdrawalsPending).toEqual([]);
    await client.allow();
    expect(client.snapshot().state.current!.id).not.toBe(old);
  });

  it('forgets everything with Forget this install, after withdrawing', async () => {
    const env = install();
    const client = await allowed(env);
    await client.record(started);
    await client.forget();
    expect(env.requests.some((request) => request.body.state === 'WITHDRAWN')).toBe(true);
    expect(client.snapshot().state).toMatchObject({ choice: null, current: null, remembered: [] });
    expect(env.rows()).toHaveLength(0);
  });
});

describe('the question', () => {
  it('is due after a story with a second of sound; closed twice it never shows by itself', async () => {
    const env = install();
    const client = await env.open();
    await client.storyEnded(800);
    expect(client.snapshot().question).toBeNull();
    await client.storyEnded(1_200);
    expect(client.snapshot().question).toBe('first');
    await client.closeQuestion();
    expect(client.snapshot().question).toBeNull();
    await client.storyEnded(5_000);
    expect(client.snapshot().question).toBe('first');
    await client.closeQuestion();
    await client.storyEnded(5_000);
    expect(client.snapshot().question).toBeNull();
    expect(client.snapshot().state.asked).toBe(2);
  });

  it('a choice ends it; a no is never asked again, even for a new policy', async () => {
    const env = install();
    const client = await env.open();
    await client.storyEnded(2_000);
    await client.withdraw();
    await client.storyEnded(2_000);
    await client.policyHeard('2027-01-01');
    expect(client.snapshot().question).toBeNull();
  });

  it('a newer policy stops counting and owes the new-policy question, without a story', async () => {
    const env = install();
    const client = await allowed(env);
    await client.policyHeard('2027-01-01');
    expect(client.snapshot()).toMatchObject({ counting: false, question: 'changed' });
    await client.allow();
    expect(env.requests.at(-1)!.body).toMatchObject({
      state: 'GRANTED',
      policyVersion: '2027-01-01',
    });
    expect(client.snapshot()).toMatchObject({ counting: true, question: null });
  });

  it('remembers a newer policy across launches; a launch never lowers it', async () => {
    const env = install();
    const client = await allowed(env);
    await client.policyHeard('2027-01-01');
    await client.allow();
    const relaunched = await env.open();
    expect(relaunched.snapshot()).toMatchObject({ counting: true, question: null });
    expect(relaunched.snapshot().state.knownPolicyVersion).toBe('2027-01-01');
  });

  it('Diagnostics: makes the question due, and pretends the policy changed', async () => {
    const env = install();
    const client = await env.open();
    await client.makeDue();
    expect(client.snapshot().question).toBe('first');
    await client.allow();
    await client.pretendPolicyChanged();
    expect(client.snapshot().question).toBe('changed');
  });
});

describe('recording', () => {
  it('fills the event: its id, the session, the clock, the narration’s own language', async () => {
    const env = install();
    const client = await allowed(env);
    await client.foreground();
    await client.record(started);
    const [opened, narration] = env.bodies();
    expect(opened).toMatchObject({ type: 'APP_OPENED', lang: 'en' });
    expect(narration).toMatchObject({
      type: 'NARRATION_STARTED',
      placeId: PLACE,
      lang: 'ko',
      trigger: 'TAP',
      audioTier: 'T1_5',
      sessionId: opened!.sessionId,
      occurredAt: '2026-11-07T10:00:00.000Z',
    });
  });

  it('a cell only from a fix under five minutes old, and never a coordinate', async () => {
    const env = install();
    const client = await allowed(env);
    env.fix.value = { lat: 10.7605, lng: 106.7035, at: env.clock.now - 60_000 };
    await client.record({ type: AnalyticsEventType.PLACE_OPENED, placeId: PLACE });
    env.fix.value = { lat: 10.7605, lng: 106.7035, at: env.clock.now - 6 * 60_000 };
    await client.record({ type: AnalyticsEventType.PLACE_OPENED, placeId: PLACE });
    const bodies = env.rows().map((row) => JSON.parse(row.body) as Record<string, unknown>);
    expect(bodies[0]!.cell).toMatch(/^[0-9b-hjkmnp-z]{7}$/);
    expect(bodies[1]!.cell).toBeUndefined();
    expect(env.rows().some((row) => hasCoordinateField(JSON.parse(row.body)))).toBe(false);
    expect(env.rows().some((row) => row.body.includes('10.76'))).toBe(false);
  });

  it('starts a session on coming to the front only after 30 quiet minutes', async () => {
    const env = install();
    const client = await allowed(env);
    await client.foreground();
    env.clock.now += SESSION_IDLE_MS - 1;
    await client.foreground();
    expect(env.bodies().filter((body) => body.type === 'APP_OPENED')).toHaveLength(1);
    env.clock.now += SESSION_IDLE_MS;
    await client.foreground();
    const sessions = new Set(env.bodies().map((body) => body.sessionId));
    expect(sessions.size).toBe(2);
  });

  it('fills every type’s own fields, caps listening at 24 h', async () => {
    const env = install();
    const client = await allowed(env);
    const tour = '01a0b373-d3eb-73c0-bd64-001fdcfca699';
    await client.record({ type: AnalyticsEventType.QR_SCANNED, target: 'TOUR' });
    await client.record({ type: AnalyticsEventType.LANGUAGE_SELECTED, lang: 'ja' });
    await client.record({ type: AnalyticsEventType.PACK_INSTALLED, props: { areaId: tour } });
    await client.record({ type: AnalyticsEventType.SEARCH_PERFORMED, resultCount: 4 });
    await client.record({ type: AnalyticsEventType.TOUR_STARTED, tourId: tour });
    await client.record({
      type: AnalyticsEventType.NARRATION_COMPLETED,
      narration: { placeId: PLACE, lang: 'en' },
      listenMs: 30 * DAY,
    });
    const bodies = env.bodies();
    expect(bodies.map((body) => [body.props, body.lang])).toEqual([
      [{ target: 'TOUR' }, 'en'],
      [{}, 'ja'],
      [{ areaId: tour }, 'en'],
      [{ resultCount: 4 }, 'en'],
      [{ tourId: tour }, 'en'],
      [{}, 'en'],
    ]);
    expect(bodies.at(-1)!.listenMs).toBe(DAY);
  });

  it('keeps at most 5,000 rows and none older than a week', async () => {
    const env = install();
    const client = await allowed(env);
    await client.record(started);
    env.clock.now += 8 * DAY;
    await client.record(started);
    expect(env.rows()).toHaveLength(1);
    for (let i = 0; i < QUEUE_MAX_ROWS + 3; i++)
      await env.deps.queue.add({ ...env.rows()[0]!, id: `x${i}` });
    await client.record(started);
    expect(env.rows()).toHaveLength(QUEUE_MAX_ROWS);
    expect(await client.queued()).toBe(QUEUE_MAX_ROWS);
  });

  it('rotates an id at 30 days, re-granting it before its events go; forgets ids after 90 days', async () => {
    const env = install();
    const client = await allowed(env);
    const first = client.snapshot().state.current!.id;
    env.clock.now += ANALYTICS_ID_ROTATION_MS - 60 * 60 * 1000;
    await client.record(started);
    env.clock.now += 60 * 60 * 1000;
    await client.record(started);
    const second = client.snapshot().state.current!.id;
    await client.flush();
    const routes = env.requests.map((request) => [request.route, request.body.analyticsDeviceId]);
    expect(routes).toEqual([
      ['consent', second],
      ['events', first],
      ['events', second],
    ]);
    env.clock.now += ANALYTICS_ID_MEMORY_MS;
    env.clock.now += ANALYTICS_ID_ROTATION_MS;
    await client.record(started);
    expect(client.snapshot().state.remembered.map((id) => id.id)).not.toContain(first);
  });
});

describe('the sender', () => {
  it('sends one id per batch, at most 100, oldest first, and deletes what was accepted', async () => {
    const env = install();
    const client = await allowed(env);
    for (let i = 0; i < 150; i++) {
      await client.record(started);
      env.clock.now += 1;
    }
    await client.flush();
    expect(env.requests.map((request) => (request.body.events as unknown[]).length)).toEqual([
      100, 50,
    ]);
    expect(env.rows()).toHaveLength(0);
  });

  it('sends at most 40 batches an hour', async () => {
    const env = install();
    const client = await allowed(env);
    for (let i = 0; i < 45 * 100; i++) {
      await client.record(started);
    }
    await client.flush();
    expect(env.requests).toHaveLength(BATCHES_PER_HOUR);
  });

  it('pagehide sends one keepalive batch of at most 50', async () => {
    const env = install();
    const client = await allowed(env);
    for (let i = 0; i < 80; i++) await client.record(started);
    await client.flush({ keepalive: true });
    expect(env.requests).toHaveLength(1);
    expect(env.requests[0]).toMatchObject({ keepalive: true });
    expect((env.requests[0]!.body.events as unknown[]).length).toBe(PAGEHIDE_MAX_EVENTS);
  });

  it('403 keeps the batch, stops counting and re-grants; the 409 names the newer policy', async () => {
    let refuse = true;
    const env = install({
      events: () => (refuse ? { status: 403 } : { status: 202 }),
      consent: () => (refuse ? { status: 409, currentVersion: '2027-01-01' } : { status: 204 }),
    });
    refuse = false;
    const client = await allowed(env);
    refuse = true;
    await client.record(started);
    await client.flush();
    expect(env.rows()).toHaveLength(1);
    expect(client.snapshot().counting).toBe(false);
    await client.flush();
    expect(env.outdated).toEqual(['2027-01-01']);
    expect(client.snapshot()).toMatchObject({ question: 'changed' });
  });

  it('400 deletes the batch and reports it; 429 waits; a failure backs off, doubling to 30 minutes', async () => {
    let answer: SendResult = { status: 400 };
    const env = install({ events: () => answer });
    const client = await allowed(env);
    await client.record(started);
    await client.flush();
    expect(env.rows()).toHaveLength(0);
    expect(env.reported).toHaveLength(1);

    answer = { status: 429, retryAfterMs: 120_000 };
    await client.record(started);
    await client.flush();
    expect(client.snapshot().state.retryAt).toBe(env.clock.now + 120_000);
    await client.flush();
    expect(env.requests.filter((request) => request.route === 'events')).toHaveLength(2);

    answer = { status: 'failed' };
    const waits: number[] = [];
    for (let i = 0; i < 8; i++) {
      env.clock.now = client.snapshot().state.retryAt ?? env.clock.now;
      await client.flush();
      waits.push(client.snapshot().state.retryAt! - env.clock.now);
    }
    expect(waits[0]).toBe(BACKOFF_FIRST_MS);
    expect(waits[1]).toBe(BACKOFF_FIRST_MS * 2);
    expect(waits.at(-1)).toBe(BACKOFF_MAX_MS);
    expect(env.rows()).toHaveLength(1);
  });

  it('tells its subscribers of each change', async () => {
    const env = install();
    const client = await env.open();
    const seen: (string | null)[] = [];
    const stop = client.subscribe((snapshot) => seen.push(snapshot.choice));
    await client.allow();
    stop();
    await client.withdraw();
    expect(seen.at(-1)).toBe('GRANTED');
  });
});
