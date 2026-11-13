// A tour that drops below two live stops while a phone holds it, made on the local stack through
// the admin API (from the repository's root): `make` a two-stop tour and wait until it is live,
// `down` takes its second stop off the map, `restore` puts the stop back and deletes the tour.
// The state goes to a JSON file between the steps (the second argument); `make` prints the code.
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'http://localhost:13000/api/v1';
const STATE = process.argv[3] ?? '/tmp/wayfare-stale-tour.json';
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

await call('POST', '/auth/login', { email: 'admin@wayfare.test', password });
const step = process.argv[2];
if (step === 'make') {
  const { data: areas } = await call('GET', '/admin/areas');
  const areaId = areas.find((area) => area.code === 'hcmc-d1-core').id;
  const stops = [];
  for (const code of ['NQ22ZQXK', 'GP7R4MY3'])
    stops.push((await call('GET', `/codes/${code}`)).data.id);
  const title = `Tour hai điểm dừng (${Date.now().toString(36)})`;
  const { data } = await call('POST', '/admin/tours', {
    titleVi: title,
    descriptionVi: 'Hai điểm dừng; một điểm sẽ tạm ngừng hoạt động.',
    areaId,
    estimatedMinutes: 20,
    stops,
    requestActivation: true,
  });
  // Live once its English is ready (the fake translates in seconds).
  for (let i = 0; i < 60; i++) {
    const { data: rows } = await call('GET', `/admin/tours?q=${encodeURIComponent(title)}`);
    if (rows.find((row) => row.id === data.tour.id)?.status === 'ACTIVE') break;
    await new Promise((done) => setTimeout(done, 2000));
  }
  writeFileSync(STATE, JSON.stringify({ tourId: data.tour.id, stop: stops[1] }));
  console.log(data.tour.publicCode);
} else if (step === 'down') {
  const { stop } = JSON.parse(readFileSync(STATE, 'utf8'));
  await call('POST', `/admin/places/${stop}/deactivate`, {
    reason: 'A tour stop taken off the map for a moment, for a Maestro capture.',
  });
} else if (step === 'restore') {
  const { tourId, stop } = JSON.parse(readFileSync(STATE, 'utf8'));
  await call('POST', `/admin/places/${stop}/activate`);
  await call('DELETE', `/admin/tours/${tourId}`);
} else {
  throw new Error('usage: stale-tour.mjs make | down | restore [state.json]');
}
