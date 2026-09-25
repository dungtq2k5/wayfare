#!/usr/bin/env node
// pnpm verify:spine — run after `pnpm walks`: proves what the walks leave on the broker, and that
// every socket frame reaches a client through Redis, not straight from the gateway. No manifest:
// the durables it expects come from the same source-text scan as
// packages/config/guards/event-topology.spec.ts — `outbox.add`/`addMany` for what is published,
// `readonly event` for what is consumed.
//
// Usage: pnpm verify:spine
//   ROOT, NATS_URL, BOOTSTRAP_SUPER_ADMIN_EMAIL/PASSWORD may be overridden. SEED_ACCOUNT_PASSWORD
//   is read from services/identity/.env — the Vĩnh Khánh owners `pnpm seed:dev` creates.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DLQ_STREAM, durableName, EVENT_DEFINITIONS, JETSTREAM_STREAMS } from '@wayfare/contracts';
import { io } from 'socket.io-client';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const nestCommon = join(repoRoot, 'packages/nest-common');
const require = createRequire(import.meta.url);
const { connect } = require(require.resolve('@nats-io/transport-node', { paths: [nestCommon] }));
const { jetstreamManager } = require(
  require.resolve('@nats-io/jetstream', { paths: [nestCommon] }),
);

const ROOT = process.env.ROOT ?? 'http://localhost:13000';
const BASE = `${ROOT}/api/v1`;
const NATS_URL = process.env.NATS_URL ?? 'nats://localhost:14222';
const ADMIN_EMAIL = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL ?? 'superadmin@wayfare.local';
const ADMIN_PASSWORD = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD ?? 'super admin pass 1';
const OWNER_EMAIL = 'owner-1@wayfare.test';
const OWNER_ID = '01a0b998-8ec8-7444-acc0-3a80371abcdb';
const VENUE_ID = '01a0b998-8ec9-770b-8dd3-f531aa696e03';
const SEED_PASSWORD = (/^SEED_ACCOUNT_PASSWORD=(.+)$/m.exec(
  readFileSync(join(repoRoot, 'services/identity/.env'), 'utf8'),
) ?? [])[1];
if (SEED_PASSWORD === undefined)
  fail('set SEED_ACCOUNT_PASSWORD in services/identity/.env (owner-1@wayfare.test)');

const SERVICES = ['identity', 'catalog', 'narration', 'billing', 'ai'];
const findings = [];

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(2);
}

/** Whether `pnpm walks` (in this run) recorded WALK as passed. `undefined` if it never ran. */
function walkPassed(walk) {
  const path = join(repoRoot, '.cache/walks-results.txt');
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${walk} `));
  return line === undefined ? undefined : line.endsWith('pass');
}

/** Every file under a service's `src`, excluding specs. */
function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (path.endsWith('.ts') && !path.endsWith('.spec.ts')) yield path;
  }
}

const allSources = new Map();
for (const service of SERVICES) {
  const dir = join(repoRoot, 'services', service, 'src');
  if (!existsSync(dir)) continue;
  for (const path of sourceFiles(dir)) allSources.set(path, readFileSync(path, 'utf8'));
}
const joinedSources = [...allSources.values()].join('\n');

// Every subject actually published: an `outbox.add`/`addMany` call anywhere in services/*/src.
const publishedSubjects = EVENT_DEFINITIONS.filter((definition) => {
  const constant = definition.subject.toUpperCase().replaceAll('.', '_');
  // FIXME `String.raw` should be used to avoid escaping `\`.
  return new RegExp(`outbox\\.(?:add|addMany)\\(tx, ${constant}\\b`).test(joinedSources);
});

// Every declared consumer: `readonly event = X` in a `*.consumer.ts`, the service from its path.
const consumers = [];
for (const [path, text] of allSources) {
  if (!path.endsWith('.consumer.ts')) continue;
  const service = /[/\\]services[/\\]([a-z0-9-]+)[/\\]src[/\\]/.exec(path)?.[1];
  const constant = /readonly event = (\w+)/.exec(text)?.[1];
  if (service === undefined || constant === undefined) continue;
  const definition = EVENT_DEFINITIONS.find(
    (d) => d.subject.toUpperCase().replaceAll('.', '_') === constant,
  );
  if (definition === undefined) continue;
  consumers.push({ service, subject: definition.subject, stream: definition.stream });
}

async function checkBroker() {
  const connection = await connect({ servers: NATS_URL, name: 'verify-spine' });
  const jsm = await jetstreamManager(connection);

  const subjectCounts = [];
  for (const definition of publishedSubjects) {
    const info = await jsm.streams.info(JETSTREAM_STREAMS[definition.stream].name, {
      subjects_filter: definition.subject,
    });
    const count = info.state.subjects?.[definition.subject] ?? 0;
    subjectCounts.push({ subject: definition.subject, messages: count });
    if (count === 0) findings.push(`${definition.subject}: no message in its stream`);
  }

  console.log('\n== subjects ==');
  console.table(subjectCounts);

  console.log('waiting 30s for every durable to go quiet…');
  await new Promise((r) => setTimeout(r, 30_000));

  const durableRows = [];
  for (const { service, subject, stream } of consumers) {
    const durable = durableName(service, subject);
    try {
      const info = await jsm.consumers.info(JETSTREAM_STREAMS[stream].name, durable);
      durableRows.push({
        durable,
        subject,
        pending: info.num_pending,
        ackPending: info.num_ack_pending,
      });
      if (info.num_pending > 0 || info.num_ack_pending > 0) {
        findings.push(`${durable}: ${info.num_pending} pending, ${info.num_ack_pending} unacked`);
      }
    } catch {
      durableRows.push({ durable, subject, pending: 'missing', ackPending: '' });
      findings.push(`${durable}: no such durable on the broker`);
    }
  }
  console.log('\n== durables ==');
  console.table(durableRows);

  const dlq = await jsm.streams.info(JETSTREAM_STREAMS[DLQ_STREAM].name);
  console.log(`\nDLQ: ${dlq.state.messages} message(s)`);
  if (dlq.state.messages > 0)
    findings.push(`DLQ: ${dlq.state.messages} message(s) left from the run`);

  await connection.drain();
}

// ---- D5: the frame scenario ----

async function login(email, password) {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wayfare-client': 'console' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) fail(`login ${email}: HTTP ${response.status}`);
  const cookie = response.headers.get('set-cookie') ?? '';
  const token = /wf_at=([^;]+)/.exec(cookie)?.[1];
  if (token === undefined) fail(`login ${email}: no wf_at cookie`);
  return token;
}

function openSocket(token) {
  const frames = [];
  const socket = io(`${ROOT}/ws`, {
    transports: ['websocket'],
    auth: { client: 'console' },
    extraHeaders: { Origin: 'http://localhost:5173', Cookie: `wf_at=${token}` },
    reconnection: false,
  });
  socket.onAny((event, payload) => frames.push({ event, payload }));
  return { socket, frames };
}

async function waitFor(what, seconds, predicate) {
  const attempts = seconds * 5;
  for (let i = 0; i < attempts; i++) {
    if (predicate()) {
      console.log(`✓ ${what}`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  findings.push(`${what}: did not happen within ${seconds}s`);
  return false;
}

async function call(name, method, path, token, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-wayfare-client': 'console',
      ...(token === undefined ? {} : { cookie: `wf_at=${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await response.json().catch(() => ({}));
  if (response.status >= 400)
    findings.push(`${name}: HTTP ${response.status} ${JSON.stringify(json)}`);
  return json;
}

async function checkFrames() {
  const adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const ownerToken = await login(OWNER_EMAIL, SEED_PASSWORD);
  const admin = openSocket(adminToken);
  const owner = openSocket(ownerToken);
  const has = (recorded, event, matches = () => true) =>
    recorded.frames.some((f) => f.event === event && matches(f.payload));

  await waitFor('the admin socket is ready', 5, () => has(admin, 'connection:ready'));
  await waitFor('the owner socket is ready', 5, () => has(owner, 'connection:ready'));

  // A text edit forces real synthesis tasks (not a cache hit) and notifies the owner in one call.
  // The job is held still rather than raced: paused the instant it's found, subscribed to, then
  // resumed — task-progress frames arrive after the subscription by construction. `editStartedAt`
  // rules out a stale job from an earlier run against the same seeded Venue: its status frames
  // already fired before this run's socket ever connected, so they never "arrive" here.
  let job;
  let paused = false;
  for (let attempt = 1; attempt <= 3 && !paused; attempt++) {
    const editStartedAt = new Date().toISOString();
    await call('edit-venue', 'PATCH', `/admin/places/${VENUE_ID}`, adminToken, {
      descriptionVi: `Verify-spine run ${Date.now()}`,
    });

    job = undefined;
    for (let i = 0; i < 25 && job === undefined; i++) {
      const jobs = await call('jobs', 'GET', '/admin/narration/jobs?pageSize=5', adminToken);
      job = jobs.data?.find((j) => j.targetId === VENUE_ID && j.createdAt >= editStartedAt);
      if (job === undefined) await new Promise((r) => setTimeout(r, 200));
    }
    if (job === undefined) {
      findings.push(`the text edit produced no synthesis job for the Venue (attempt ${attempt})`);
      continue;
    }

    const response = await fetch(`${BASE}/admin/narration/jobs/${job.id}/pause`, {
      method: 'POST',
      headers: { 'x-wayfare-client': 'console', cookie: `wf_at=${adminToken}` },
    });
    if (response.status === 200) {
      paused = true;
    } else if (response.status !== 409) {
      findings.push(`pause: HTTP ${response.status} (attempt ${attempt})`);
    }
  }

  if (job === undefined) {
    // Already a finding, from the loop above.
  } else if (!paused) {
    // A fast fake job can outrun the create-then-pause race however many times it's retried —
    // that's a real clock, not a bug. `narration:job:status` needs no subscription (the admin
    // socket already sits in `admin:narration`), so it's still checked directly; only
    // `narration:task:progress` strictly needs the pause. `walk-narration.sh` holds its own job
    // running on purpose and already proves that same frame arrives through Redis, so a lost race
    // defers to it rather than failing the run over a race nothing can reliably win.
    await waitFor('narration:job:status arrived', 10, () =>
      has(admin, 'narration:job:status', (p) => p.jobId === job.id),
    );
    const coveredByWalk = walkPassed('narration');
    if (coveredByWalk === true) {
      console.log('✓ narration:task:progress — covered by walk-narration.sh in this run');
    } else if (coveredByWalk === false) {
      findings.push('narration:task:progress: the pause race was lost, and walk-narration failed');
    } else {
      findings.push(
        'narration:task:progress: the pause race was lost, and walk-narration never ran',
      );
    }
  } else {
    admin.socket.emit('job:subscribe', { jobId: job.id });
    await waitFor('job:subscribed', 5, () =>
      has(admin, 'job:subscribed', (p) => p.jobId === job.id),
    );
    await call('resume', 'POST', `/admin/narration/jobs/${job.id}/resume`, adminToken);
    await waitFor('narration:job:status arrived', 10, () =>
      has(admin, 'narration:job:status', (p) => p.jobId === job.id),
    );
    await waitFor('narration:task:progress arrived', 10, () =>
      has(admin, 'narration:task:progress', (p) => p.jobId === job.id),
    );
  }

  await waitFor('the owner is told PLACE_EDITED_BY_ADMIN', 10, () =>
    has(owner, 'notification:new', (p) => p.type === 'PLACE_EDITED_BY_ADMIN'),
  );
  await waitFor('the owner sees an unread count', 10, () =>
    has(owner, 'notification:unread-count'),
  );

  const feed = await call('feed', 'GET', '/notifications?unreadOnly=true&limit=1', ownerToken);
  const notificationId = feed.data?.[0]?.id;
  if (notificationId === undefined) {
    findings.push('the owner has no unread notification to read');
  } else {
    await call('read', 'POST', `/notifications/${notificationId}/read`, ownerToken, {});
    await waitFor('notification:read arrived', 10, () => has(owner, 'notification:read'));
  }

  await call('deactivate', 'POST', `/admin/places/${VENUE_ID}/deactivate`, adminToken, {
    reason: 'verify:spine: a temporary closure',
  });
  await waitFor('owner:place:status (deactivated) arrived', 10, () =>
    has(owner, 'owner:place:status', (p) => p.placeId === VENUE_ID && p.status !== 'ACTIVE'),
  );
  await call('activate', 'POST', `/admin/places/${VENUE_ID}/activate`, adminToken);
  await waitFor('owner:place:status (active again) arrived', 10, () =>
    has(owner, 'owner:place:status', (p) => p.placeId === VENUE_ID && p.status === 'ACTIVE'),
  );

  const accounts = await call(
    'accounts',
    'GET',
    '/admin/billing/accounts?pageSize=100',
    adminToken,
  );
  const account = accounts.data?.find((a) => a.ownerUserId === OWNER_ID);
  if (account === undefined) {
    findings.push(`no billing account for owner ${OWNER_ID}`);
  } else {
    // An override writes a new entitlements version only when the grants actually differ — the
    // account stays pinned to whatever a previous run left it at, so a fixed maxPlaces would be a
    // silent no-op (and no frame) on every run after the first. walk-billing.sh already exercises
    // the Stripe webhook path itself; this only needs one guaranteed `billing.entitlements.changed`.
    await call(
      'override',
      'PATCH',
      `/admin/billing/accounts/${account.id}/entitlements`,
      adminToken,
      {
        grants: {
          maxPlaces: 10 + (Date.now() % 50),
          autoNarration: true,
          narrationLanguageScope: 'BASIC',
          maxPhotosPerPlace: 5,
          maxMenuItemsPerPlace: 50,
          discoveryBoostSlots: 0,
          aiCreditsPerDay: 0,
          analyticsLevel: 'NONE',
          canSellVouchers: false,
          voucherCommissionBps: null,
        },
        reason: 'verify:spine: a negotiated grant',
      },
    );
    await waitFor('owner:entitlements arrived', 10, () => has(owner, 'owner:entitlements'));
  }

  admin.socket.disconnect();
  owner.socket.disconnect();
}

console.log(
  `== event topology: ${publishedSubjects.length} published subject(s), ${consumers.length} consumer(s) ==`,
);
try {
  await checkBroker();
  console.log('\n== the frame scenario ==');
  await checkFrames();
} catch (error) {
  findings.push(`crashed: ${error.message}`);
}

console.log('\n== report ==');
if (findings.length === 0) {
  console.log(
    '✓ every Phase 2 subject was published, consumed and left nothing behind, and every frame arrived',
  );
} else {
  for (const finding of findings) console.log(`✗ ${finding}`);
}
process.exitCode = findings.length === 0 ? 0 : 1;
