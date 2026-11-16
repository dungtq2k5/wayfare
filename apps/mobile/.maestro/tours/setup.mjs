// The tours' Maestro records, made through the admin API on the local stack and found again by
// title on a later run: a taken-down tour (TM5b) and a live tour with a skipped stop (TM2b) — a
// draft Place between two live ones, which the phone never syncs, one per theme. Prints {"gone", "run"}.
// Run from the repository's root: node apps/mobile/.maestro/tours/setup.mjs
import { readFileSync } from 'node:fs';

const API = 'http://localhost:13000/api/v1';
const password = readFileSync('services/identity/.env', 'utf8')
  .split('\n')
  .find((line) => line.startsWith('SEED_ACCOUNT_PASSWORD='))
  .slice('SEED_ACCOUNT_PASSWORD='.length)
  .trim();
let cookie = '';

async function call(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'x-wayfare-client': 'console',
      cookie,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const set = response.headers.getSetCookie().map((line) => line.split(';')[0]);
  if (set.length > 0) cookie = set.join('; ');
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}

const tourByTitle = async (title) =>
  (await call('GET', `/admin/tours?q=${encodeURIComponent(title)}&includeDeleted=true`)).data.find(
    (row) => row.titleVi === title,
  );

await call('POST', '/auth/login', { email: 'admin@wayfare.test', password });
const { data: areas } = await call('GET', '/admin/areas');
const areaId = areas.find((area) => area.code === 'hcmc-d1-core').id;
const ids = {};
for (const code of ['QK4V1TCX', 'NQ22ZQXK', 'GP7R4MY3']) {
  ids[code] = (await call('GET', `/codes/${code}`)).data.id;
}
const byCode = (code) => ids[code];

// TM5b: made, then taken down.
const GONE = 'Tour đã gỡ (Maestro)';
let gone = await tourByTitle(GONE);
if (gone === undefined) {
  ({ tour: gone } = (
    await call('POST', '/admin/tours', {
      titleVi: GONE,
      descriptionVi: 'Một tour thử cho liên kết đã gỡ.',
      areaId,
      estimatedMinutes: 30,
      stops: [byCode('QK4V1TCX'), byCode('NQ22ZQXK')],
      requestActivation: false,
    })
  ).data);
}
if (gone.deletedAt === null) await call('DELETE', `/admin/tours/${gone.id}`);

// TM2b: two live stops around a draft Place.
const DRAFT = 'Đình thử Maestro (bản nháp)';
let draft = (
  await call('GET', `/admin/places?q=${encodeURIComponent(DRAFT)}&pageSize=10`)
).data.find((place) => place.nameVi === DRAFT);
if (draft === undefined) {
  draft = (
    await call('POST', '/admin/places', {
      nameVi: DRAFT,
      descriptionVi: 'Một ngôi đình thử, còn là bản nháp.',
      categoryCode: 'TEMPLE',
      location: { lat: 10.7761, lng: 106.7009 },
      addressVi: null,
      triggerRadiusM: 30,
      narrationPriority: 50,
      photos: [],
      openingHours: [],
      requestActivation: false,
    })
  ).data.place;
}
// One per theme and run, so each is first seen not started (a tour's progress is per phone, per
// tour, and a run finishes it).
const run = Date.now().toString(36);
// Earlier runs' are taken down first, so Explore's list stays short enough to scroll.
const { data: earlier } = await call(
  'GET',
  `/admin/tours?q=${encodeURIComponent('Tour có điểm bỏ qua')}&pageSize=100`,
);
for (const row of earlier) {
  if (row.deletedAt === null) await call('DELETE', `/admin/tours/${row.id}`);
}
for (const theme of ['light', 'dark']) {
  const title = `Tour có điểm bỏ qua (${theme} ${run})`;
  if ((await tourByTitle(title)) === undefined) {
    await call('POST', '/admin/tours', {
      titleVi: title,
      descriptionVi: 'Ba điểm dừng, một điểm chưa mở cho du khách.',
      areaId,
      estimatedMinutes: 40,
      stops: [byCode('NQ22ZQXK'), draft.id, byCode('GP7R4MY3')],
      requestActivation: true,
    });
  }
  // Live once its English is ready (the fake translates in seconds).
  for (let i = 0; i < 60 && (await tourByTitle(title)).status !== 'ACTIVE'; i++) {
    await new Promise((done) => setTimeout(done, 2000));
  }
}
console.log(JSON.stringify({ gone: gone.publicCode, run }));
