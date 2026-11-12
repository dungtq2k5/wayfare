// The crowd (infra/load/README.md): `tourists`, each virtual user one install — it registers,
// launches, then ticks every 5 s — and `qr`, one sticker scanned a second. Thresholds fail the run
// on the steady hold's numbers; the spike and the recovery are reported beside them.
import exec from 'k6/execution';
import http from 'k6/http';
import { sleep } from 'k6';
import { Trend } from 'k6/metrics';
import {
  API,
  BASE,
  call,
  data,
  errors,
  forwardedFor,
  geohash7,
  PHASES,
  phaseAt,
  pointAt,
  POLICY,
  RUN_SECONDS,
  SMOKE,
  STAGES,
} from './lib.js';

/** A whole paged full sync, from the first page's request to the last page's answer. */
const syncFull = new Trend('sync_full_ms', true);
/** From the on-demand request to the status saying the long-tail text is ready. */
const onDemandReady = new Trend('on_demand_ready_ms', true);
/** A delta's body, all its pages together. */
const deltaBytes = new Trend('delta_bytes');

const TICK_S = 5;
/** Every how many ticks each periodic step runs: the run's cadence, and the smoke's quicker one. */
const EVERY = SMOKE
  ? { prefetch: 2, listen: 3, analytics: 4, delta: 5 }
  : { prefetch: 12, listen: 24, analytics: 60, delta: 60 };
/** A device token is refreshed this long after it was issued (it lives 15 minutes). */
const REFRESH_MS = SMOKE ? 15_000 : 14 * 60_000;
/** The long-tail languages: translated on demand (the launch languages are already there). */
const LONG_TAIL = ['fr', 'de', 'es', 'ru', 'th', 'id', 'ms', 'hi', 'zh-Hant'];

const ROUTES = [
  'register',
  'token',
  'consent',
  'areas',
  'categories',
  'bundle',
  'sync_page',
  'sync_delta',
  'sync_tours',
  'hotset',
  'nearby',
  'prefetch',
  'place',
  'on_demand',
  'status',
  'stream',
  'analytics',
  'telemetry',
  'qr',
];

/** The failing budgets, on the hold (K7); every other route and phase is measured for the report. */
const HOLD_P95 = {
  nearby: 150,
  place: 200,
  prefetch: 300,
  analytics: 200,
  qr: 100,
};

function thresholds() {
  // Measured for the report: an expression that always holds keeps each sub-metric in the summary.
  const all = {};
  for (const route of ROUTES) {
    for (const phase of PHASES) {
      all[`http_req_duration{route:${route},phase:${phase}}`] = ['p(50)>=0'];
      all[`http_reqs{route:${route},phase:${phase}}`] = ['count>=0'];
      all[`errors{route:${route},phase:${phase}}`] = ['rate>=0'];
    }
  }
  for (const phase of PHASES) all[`on_demand_ready_ms{phase:${phase}}`] = ['p(50)>=0'];
  if (SMOKE) {
    // Every call of the contract answers as expected, and each was made.
    for (const route of ROUTES) all[`http_reqs{route:${route}}`] = ['count>0'];
    return { ...all, checks: ['rate==1'] };
  }
  // The budgets (K7): the hold's fail the run; the spike and the recovery fail only past 1 %.
  for (const route of ROUTES) {
    all[`errors{route:${route},phase:hold}`] = ['rate<0.005'];
    if (HOLD_P95[route]) {
      all[`http_req_duration{route:${route},phase:hold}`] = [`p(95)<${HOLD_P95[route]}`];
    }
  }
  return {
    ...all,
    sync_full_ms: ['p(95)<1500'],
    'http_req_duration{route:sync_delta}': ['p(95)<300'],
    delta_bytes: ['max<51200'],
    'on_demand_ready_ms{phase:hold}': ['p(95)<5000'],
    'errors{phase:spike}': ['rate<0.01'],
    'errors{phase:recovery}': ['rate<0.01'],
  };
}

export const options = {
  scenarios: {
    tourists: {
      executor: 'ramping-vus',
      exec: 'tourist',
      // The smoke's five installs start together, so each reaches every step inside its minute.
      startVUs: SMOKE ? 5 : 0,
      stages: STAGES.map(({ duration, target }) => ({ duration, target })),
      gracefulRampDown: '10s',
      gracefulStop: '30s',
    },
    qr: {
      executor: 'constant-arrival-rate',
      exec: 'scan',
      rate: 1,
      timeUnit: '1s',
      duration: `${RUN_SECONDS}s`,
      preAllocatedVUs: 5,
      maxVUs: 20,
    },
  },
  thresholds: thresholds(),
  summaryTrendStats: ['count', 'avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
  setupTimeout: '5m',
  noCookiesReset: true,
};

const HEADERS = { 'X-Wayfare-Client': 'mobile', 'X-Forwarded-For': '10.254.0.1' };

/** Every page of a sync, from `since`; its places, the final version and the bytes read. */
function syncAll(get, path, areaId, since) {
  let version = since;
  const places = [];
  let bytes = 0;
  for (;;) {
    const query = `areaId=${areaId}&lang=en${version === null ? '' : `&since=${version}`}`;
    const response = get(`${path}?${query}`);
    if (response.status !== 200) return { places, version, bytes, ok: false };
    bytes += response.body.length;
    const page = response.json();
    places.push(...(page.data.places ?? page.data.tours ?? []));
    version = page.data.datasetVersion;
    if (page.meta.complete) return { places, version, bytes, ok: true };
  }
}

/** One full sync, the way the spike's installs got theirs: its final version, the codes to scan. */
export function setup() {
  const register = http.post(
    `${API}/devices`,
    JSON.stringify({
      platform: 'ANDROID',
      appVersion: '0.1.0',
      contentLocale: 'en',
      privacyPolicyVersion: POLICY,
    }),
    { headers: { ...HEADERS, 'Content-Type': 'application/json' } },
  );
  if (register.status !== 201) throw new Error(`setup: POST /devices → ${register.status}`);
  const token = register.json('data.accessToken');
  const headers = { ...HEADERS, Authorization: `Bearer ${token}` };
  const areas = http.get(`${API}/areas`, { headers }).json('data');
  const area = areas.find((row) => row.code === 'hcmc-d1-core');
  if (area === undefined) throw new Error('setup: no hcmc-d1-core area — run pnpm seed:dev');
  const full = syncAll(
    (url) => http.get(`${API}${url}`, { headers }),
    '/sync/places',
    area.id,
    null,
  );
  if (!full.ok) throw new Error('setup: the full sync failed');
  if (!SMOKE && full.places.length < 2_000) {
    throw new Error(`setup: ${full.places.length} live Places — run pnpm seed:load first`);
  }
  const version = http.get(`${BASE}/version`, { headers: HEADERS });
  console.log(
    `stack ${version.body}; ${full.places.length} live Places in ${area.code}, dataset version ${full.version}`,
  );
  return {
    start: Date.now(),
    areaId: area.id,
    datasetVersion: full.version,
    codes: full.places.map((place) => place.publicCode).filter(Boolean),
    places: full.places.length,
    version: version.body,
  };
}

/** This VU's install: kept from one tick to the next. */
let install = null;

function uuid() {
  return crypto.randomUUID();
}

function launch(setupData) {
  const n = exec.vu.idInTest;
  const ip = forwardedFor(n);
  const s = setupData.start;
  const registered = call(
    s,
    ip,
    'register',
    'POST',
    `${API}/devices`,
    {
      platform: 'ANDROID',
      appVersion: '0.1.0',
      contentLocale: 'en',
      privacyPolicyVersion: POLICY,
    },
    { expect: [201] },
  );
  const device = data(registered);
  if (device === null) return null;
  const me = {
    n,
    ip,
    tick: 0,
    deviceId: device.deviceId,
    secret: device.deviceSecret,
    token: device.accessToken,
    issuedAt: Date.now(),
    analyticsId: uuid(),
    sessionId: uuid(),
    nearby: [],
    telemetry: false,
  };
  const as = { token: me.token };
  call(
    s,
    ip,
    'consent',
    'POST',
    `${API}/analytics/consent`,
    {
      analyticsDeviceId: me.analyticsId,
      state: 'GRANTED',
      policyVersion: POLICY,
    },
    { ...as, expect: [204] },
  );
  call(s, ip, 'areas', 'GET', `${API}/areas`, null);
  call(s, ip, 'categories', 'GET', `${API}/categories`, null);
  call(s, ip, 'bundle', 'GET', `${API}/i18n/bundles/tourist/en`, null);
  // Installs launched after the hold are the spike's: a tour bus that synced at its hotel.
  const late = ['spike', 'recovery'].includes(phaseAt(Date.now() - s));
  if (!late) {
    // A first launch: the whole corpus, page by page.
    const began = Date.now();
    const full = syncAll(
      (url) => call(s, ip, 'sync_page', 'GET', `${API}${url}`, null, as),
      '/sync/places',
      setupData.areaId,
      null,
    );
    if (full.ok) syncFull.add(Date.now() - began);
    me.version = full.version;
  } else {
    me.version = delta(me, setupData);
  }
  call(
    s,
    ip,
    'sync_tours',
    'GET',
    `${API}/sync/tours?areaId=${setupData.areaId}&lang=en`,
    null,
    as,
  );
  const here = pointAt(n, 0);
  call(s, ip, 'hotset', 'POST', `${API}/narration/hotset`, { ...here, lang: 'en' }, as);
  return me;
}

/** A delta from the install's last version: every page; its size recorded. */
function delta(me, setupData) {
  const result = syncAll(
    (url) =>
      call(setupData.start, me.ip, 'sync_delta', 'GET', `${API}${url}`, null, { token: me.token }),
    '/sync/places',
    setupData.areaId,
    me.version ?? setupData.datasetVersion,
  );
  if (result.ok) deltaBytes.add(result.bytes);
  return result.ok ? result.version : (me.version ?? setupData.datasetVersion);
}

/**
 * Listening: the Place; its text in a long-tail language made on demand, polled until ready; then
 * its audio streamed. Long-tail languages are text-only (no voice is pinned for them, under any
 * provider), so the audio played is the Place's English, as the walk would play it.
 */
function listen(me, setupData) {
  const s = setupData.start;
  const as = { token: me.token };
  if (me.nearby.length === 0) return;
  const placeId = me.nearby[(me.n + me.tick) % me.nearby.length];
  const lang = LONG_TAIL[(me.n + me.tick) % LONG_TAIL.length];
  call(s, me.ip, 'place', 'GET', `${API}/places/${placeId}?lang=en`, null, as);
  const began = Date.now();
  const asked = call(
    s,
    me.ip,
    'on_demand',
    'POST',
    `${API}/narration/on-demand`,
    { placeId, lang },
    { ...as, expect: [200, 202] },
  );
  if (asked.status === 202) {
    // Polled every half second, not at the answer's `retryAfterMs` (a client's pacing): the time
    // measured is when the text is ready, not when a client would next look.
    const deadline = began + 30_000;
    for (;;) {
      sleep(0.5);
      const status = call(
        s,
        me.ip,
        'status',
        'GET',
        `${API}/narration/places/${placeId}/status?lang=${lang}`,
        null,
      );
      if (data(status)?.textReady === true) break;
      if (Date.now() > deadline) {
        errors.add(true, { route: 'on_demand_ready', phase: 'any' });
        return;
      }
    }
  } else if (asked.status !== 200) {
    return;
  }
  onDemandReady.add(Date.now() - began);
  call(s, me.ip, 'stream', 'GET', `${API}/narration/tts/stream?placeId=${placeId}&lang=en`, null, {
    ...as,
    discard: true,
  });
}

function analytics(me, setupData) {
  const now = new Date().toISOString();
  const events = Array.from({ length: 20 }, (_, index) =>
    index % 2 === 0 || me.nearby.length === 0
      ? { id: uuid(), sessionId: me.sessionId, type: 'APP_OPENED', occurredAt: now, props: {} }
      : {
          id: uuid(),
          sessionId: me.sessionId,
          type: 'PLACE_OPENED',
          occurredAt: now,
          placeId: me.nearby[index % me.nearby.length],
          lang: 'en',
          cell: geohash7(pointAt(me.n, me.tick).lat, pointAt(me.n, me.tick).lng),
          props: {},
        },
  );
  const sent = call(
    setupData.start,
    me.ip,
    'analytics',
    'POST',
    `${API}/analytics/events`,
    {
      analyticsDeviceId: me.analyticsId,
      events,
    },
    { token: me.token, expect: [202] },
  );
  // A bad event is dropped while the batch still answers 202.
  const dropped = data(sent)?.dropped;
  if (sent.status === 202 && dropped !== 0) {
    errors.add(true, { route: 'analytics', phase: 'dropped' });
    console.warn(`analytics dropped ${dropped} of 20`);
  }
}

/** One install, one tick: the first one launches it. */
export function tourist(setupData) {
  if (install === null) {
    install = launch(setupData);
    if (install === null) {
      sleep(TICK_S);
      return;
    }
  }
  const me = install;
  const s = setupData.start;
  me.tick += 1;
  if (Date.now() - me.issuedAt > REFRESH_MS) {
    const refreshed = call(s, me.ip, 'token', 'POST', `${API}/devices/token`, {
      deviceId: me.deviceId,
      deviceSecret: me.secret,
    });
    const token = data(refreshed)?.accessToken;
    if (token) {
      me.token = token;
      me.issuedAt = Date.now();
    }
  }
  const as = { token: me.token };
  // A web map panned along the walk: a deliberate overestimate (the Android app reads its synced
  // records and never calls nearby).
  const here = pointAt(me.n, me.tick);
  const nearby = call(
    s,
    me.ip,
    'nearby',
    'GET',
    `${API}/places/nearby?lat=${here.lat}&lng=${here.lng}&radiusM=1000&limit=50&lang=en`,
    null,
    as,
  );
  const found = data(nearby)?.places ?? data(nearby);
  if (Array.isArray(found) && found.length > 0) me.nearby = found.map((place) => place.id);
  if (!me.telemetry) {
    call(
      s,
      me.ip,
      'telemetry',
      'POST',
      `${API}/telemetry/activity`,
      { areaId: setupData.areaId },
      {
        ...as,
        expect: [204],
      },
    );
    me.telemetry = true;
  }
  if (me.tick % EVERY.prefetch === 0 && me.nearby.length > 0) {
    call(
      s,
      me.ip,
      'prefetch',
      'POST',
      `${API}/narration/prefetch`,
      {
        placeIds: me.nearby.slice(0, 3),
        lang: 'en',
      },
      { ...as, expect: [202] },
    );
  }
  if (me.tick % EVERY.listen === 0) listen(me, setupData);
  if (me.tick % EVERY.analytics === 0) analytics(me, setupData);
  if (me.tick % EVERY.delta === 0) me.version = delta(me, setupData);
  sleep(TICK_S);
}

/** A sticker scanned by a phone's camera: no client header, the redirect not followed. */
export function scan(setupData) {
  const i = exec.scenario.iterationInTest;
  const code = setupData.codes[i % setupData.codes.length];
  call(setupData.start, forwardedFor((200 << 16) + i), 'qr', 'GET', `${BASE}/q/${code}`, null, {
    bare: true,
    expect: [302],
    redirects: 0,
  });
}

/** Per route and phase: requests, p50, p95, p99, errors — and the run's own numbers. */
export function handleSummary(summary) {
  const metric = (name) => summary.metrics[name]?.values;
  const lines = [];
  const setupData = summary.setup_data ?? {};
  lines.push(`Wayfare load run — ${new Date().toISOString()}${SMOKE ? ' (smoke)' : ''}`);
  lines.push(`stack: ${setupData.version ?? '?'}; ${setupData.places ?? '?'} live Places`);
  lines.push('');
  lines.push(
    ['route', 'phase', 'requests', 'p50', 'p95', 'p99', 'errors']
      .map((cell) => cell.padEnd(11))
      .join(''),
  );
  for (const route of ROUTES) {
    for (const phase of SMOKE ? ['hold'] : PHASES) {
      const time = metric(`http_req_duration{route:${route},phase:${phase}}`);
      const count = metric(`http_reqs{route:${route},phase:${phase}}`)?.count;
      const errorRate = metric(`errors{route:${route},phase:${phase}}`)?.rate;
      if (!count) continue;
      const ms = (value) => (value === undefined ? '—' : `${value.toFixed(0)}`);
      lines.push(
        [
          route,
          phase,
          String(count),
          ms(time?.['p(50)']),
          ms(time?.['p(95)']),
          ms(time?.['p(99)']),
          errorRate === undefined ? '—' : `${(errorRate * 100).toFixed(2)} %`,
        ]
          .map((cell) => cell.padEnd(11))
          .join(''),
      );
    }
  }
  const full = metric('sync_full_ms');
  const ready = metric('on_demand_ready_ms');
  const bytes = metric('delta_bytes');
  lines.push('');
  lines.push(
    `sync_full_ms: p50 ${full?.['p(50)']?.toFixed(0)} p95 ${full?.['p(95)']?.toFixed(0)} (n ${full?.count})`,
  );
  lines.push(
    `on_demand_ready_ms: p50 ${ready?.['p(50)']?.toFixed(0)} p95 ${ready?.['p(95)']?.toFixed(0)} (n ${ready?.count})`,
  );
  lines.push(
    `delta bytes: p50 ${bytes?.['p(50)']?.toFixed(0)} max ${bytes?.max?.toFixed(0)} (n ${bytes?.count})`,
  );
  const failed = Object.entries(summary.metrics)
    .filter(([, value]) => value.thresholds && Object.values(value.thresholds).some((t) => !t.ok))
    .map(([name]) => name);
  lines.push('');
  lines.push(
    failed.length === 0 ? 'thresholds: all held' : `thresholds missed: ${failed.join(', ')}`,
  );
  const text = `${lines.join('\n')}\n`;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    stdout: text,
    [`results/summary-${stamp}${SMOKE ? '-smoke' : ''}.txt`]: text,
    [`results/summary-${stamp}${SMOKE ? '-smoke' : ''}.json`]: JSON.stringify(summary, null, 2),
  };
}
