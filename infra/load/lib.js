// What every install and every QR scan shares: the request helpers that tag each call with its
// route and phase, the forwarded address, the moving point, and the stages the phase is read from.
import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

/* global __ENV -- k6's environment, set by run.sh. */

export const BASE = `${__ENV.BASE_URL || 'http://gateway:3000'}`;
export const API = `${BASE}/api/v1`;
export const SMOKE = __ENV.SMOKE === '1';
export const POLICY = __ENV.PRIVACY_POLICY_VERSION;

/** Failed calls, by route and phase: a `429` counts, and so does a check that didn't hold. */
export const errors = new Rate('errors');

/**
 * The crowd's stages (seconds), and the phase each belongs to. The ramps into and out of the spike
 * count as the spike, so the hold's numbers are the steady crowd's alone.
 */
export const STAGES = SMOKE
  ? [{ duration: '1m', target: 5, phase: 'hold' }]
  : [
      { duration: '2m', target: 300, phase: 'ramp' },
      { duration: '10m', target: 300, phase: 'hold' },
      { duration: '30s', target: 900, phase: 'spike' },
      { duration: '2m', target: 900, phase: 'spike' },
      { duration: '30s', target: 300, phase: 'spike' },
      { duration: '3m', target: 300, phase: 'recovery' },
      { duration: '30s', target: 0, phase: 'recovery' },
    ];
export const PHASES = ['ramp', 'hold', 'spike', 'recovery'];

const seconds = (duration) =>
  duration.endsWith('m') ? Number(duration.slice(0, -1)) * 60 : Number(duration.slice(0, -1));

/** The whole run, in seconds. */
export const RUN_SECONDS = STAGES.reduce((sum, stage) => sum + seconds(stage.duration), 0);

/** The phase `elapsedMs` after the scenarios started falls in. */
export function phaseAt(elapsedMs) {
  let end = 0;
  for (const stage of STAGES) {
    end += seconds(stage.duration) * 1000;
    if (elapsedMs < end) return stage.phase;
  }
  return STAGES[STAGES.length - 1].phase;
}

/** `10.a.b.c` from a number: one install, one network, as phones on different networks are. */
export function forwardedFor(n) {
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

/**
 * One call, tagged with its route and the run's phase now, checked against the statuses it may
 * answer. Every call carries the mobile client header unless `bare` (a QR scan from a camera).
 */
export function call(start, ip, route, method, url, body, options = {}) {
  const { token, expect = [200], bare = false, redirects, discard = false } = options;
  const headers = { 'X-Forwarded-For': ip };
  if (!bare) headers['X-Wayfare-Client'] = 'mobile';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  const tags = { route, name: route, phase: phaseAt(Date.now() - start) };
  const response = http.request(method, url, body === null ? null : JSON.stringify(body), {
    headers,
    tags,
    ...(redirects === undefined ? {} : { redirects }),
    // An audio body is read and dropped: the crowd measures its delivery, not its bytes.
    ...(discard ? { responseType: 'none' } : {}),
  });
  const ok = check(
    response,
    { [`${route} ${expect.join('|')}`]: (r) => expect.includes(r.status) },
    tags,
  );
  errors.add(!ok, tags);
  return response;
}

/** A body's `data`, or null when it isn't JSON. */
export function data(response) {
  try {
    return response.json('data');
  } catch {
    return null;
  }
}

/**
 * A walk along Đồng Khởi and Lê Lợi, District 1: each install starts somewhere on it and moves
 * about 5 m a tick, turning back at the ends.
 */
const STREET = [
  [10.7798, 106.6995],
  [10.7769, 106.7032],
  [10.7743, 106.7046],
  [10.7726, 106.7008],
  [10.7714, 106.6979],
];
const LEGS = STREET.slice(1).map((end, index) => {
  const start = STREET[index];
  const metres = Math.hypot((end[0] - start[0]) * 110_574, (end[1] - start[1]) * 109_200);
  return { start, end, metres };
});
const LENGTH = LEGS.reduce((sum, leg) => sum + leg.metres, 0);

/** Where install `n` is after `tick` ticks of 5 m. */
export function pointAt(n, tick) {
  const travelled = (n * 37 + tick * 5) % (2 * LENGTH);
  let along = travelled <= LENGTH ? travelled : 2 * LENGTH - travelled;
  for (const leg of LEGS) {
    if (along <= leg.metres) {
      const t = along / leg.metres;
      return {
        lat: Number((leg.start[0] + t * (leg.end[0] - leg.start[0])).toFixed(6)),
        lng: Number((leg.start[1] + t * (leg.end[1] - leg.start[1])).toFixed(6)),
      };
    }
    along -= leg.metres;
  }
  return { lat: STREET[STREET.length - 1][0], lng: STREET[STREET.length - 1][1] };
}

/** A geohash of a point, precision 7 (~150 m), as the apps snap a location before sending it. */
export function geohash7(lat, lng) {
  const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
  let [latLo, latHi, lngLo, lngHi] = [-90, 90, -180, 180];
  let hash = '';
  let bits = 0;
  let value = 0;
  let even = true;
  while (hash.length < 7) {
    if (even) {
      const mid = (lngLo + lngHi) / 2;
      value = (value << 1) | (lng >= mid ? 1 : 0);
      if (lng >= mid) lngLo = mid;
      else lngHi = mid;
    } else {
      const mid = (latLo + latHi) / 2;
      value = (value << 1) | (lat >= mid ? 1 : 0);
      if (lat >= mid) latLo = mid;
      else latHi = mid;
    }
    even = !even;
    if (++bits === 5) {
      hash += alphabet[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}
