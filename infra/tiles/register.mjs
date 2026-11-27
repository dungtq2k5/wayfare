// node infra/tiles/register.mjs --area <code> — registers the pack `upload.mjs` just wrote
// (`.cache/build/<code>/register.json`) through the gateway, as design 35 says the build does.
// Publishing stays in the console. It takes an area code, not a path: the file it reads is always
// one of the build's own.
//
// Signs in as a staff account holding `map_pack.manage`, as the `console` client: a script keeps
// the session's cookies itself, and a `mobile` session would need an app version it doesn't have.
// It signs out at the end, whatever happened, so no build leaves a live staff session behind.
//
// build.sh resolves the settings — TILES_ADMIN_EMAIL and TILES_GATEWAY_URL from the shell or the
// gitignored `infra/tiles/.env` — and passes them as arguments; the password comes on stdin, never
// in the arguments (`ps` shows those). Without them, nothing is registered and it says why.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const catalogDir = resolve(here, '../../services/catalog');
const { parse } = createRequire(join(catalogDir, 'package.json'))('dotenv');
const { values: args } = parseArgs({
  options: {
    area: { type: 'string' },
    email: { type: 'string', default: '' },
    gateway: { type: 'string', default: '' },
  },
});
// An area code, as build.sh checks it: letters, digits and hyphens.
if (args.area === undefined || !/^[a-z0-9-]+$/i.test(args.area)) {
  console.error('✗ --area <code> is required: letters, digits and hyphens');
  process.exit(2);
}
const builds = resolve(here, '.cache/build');
const out = resolve(builds, args.area);
const inside = relative(builds, out);
if (inside === '' || inside.startsWith('..') || inside.includes('/')) {
  console.error(`✗ --area ${args.area} isn't a build of infra/tiles/.cache/build/`);
  process.exit(2);
}
if (!existsSync(join(out, 'register.json'))) {
  console.error(`✗ no build of ${args.area} to register: run pnpm tiles:build --area ${args.area}`);
  process.exit(2);
}
const body = JSON.parse(readFileSync(join(out, 'register.json'), 'utf8')); // NOSONAR: S8707, --area is checked to [a-z0-9-]+ and its directory to a direct child of .cache/build/ above; the taint analysis counts neither check
const email = args.email;
const password = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
const gateway = (args.gateway || 'http://localhost:13000').replace(/\/$/, '');
// The bucket upload.mjs wrote to, which the gateway's catalog must read for the re-hash.
const bucket = parse(readFileSync(join(catalogDir, '.env'))).GCS_BUCKET_MEDIA;
const where = `the gateway at ${gateway}; uploaded to the bucket ${bucket}`;

const missing = [
  email === '' ? 'TILES_ADMIN_EMAIL' : null,
  password === '' ? 'TILES_ADMIN_PASSWORD' : null,
].filter((name) => name !== null);
if (missing.length > 0) {
  console.error(
    `• not registered: ${missing.join(' and ')} not set (infra/tiles/README.md); the body is in ${join(out, 'register.json')}`,
  );
  process.exit(0);
}

/** The session's cookies, carried by hand: the `console` client's tokens live in them. */
let cookies = '';
const call = async (method, path, payload) => {
  const response = await fetch(`${gateway}/api/v1${path}`, {
    method,
    headers: {
      'x-wayfare-client': 'console',
      'content-type': 'application/json',
      ...(cookies === '' ? {} : { cookie: cookies }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const set = response.headers.getSetCookie().map((line) => line.split(';')[0]);
  if (set.length > 0) cookies = set.join('; ');
  const text = await response.text();
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
};
const codeOf = (result) => result.json?.error?.code ?? `HTTP ${result.status}`;

let signedIn = false;
let failed = false;
try {
  const login = await call('POST', '/auth/login', { email, password });
  if (login.status !== 200) {
    throw new Error(`signing in as ${email} failed: ${codeOf(login)}`);
  }
  signedIn = true;
  const result = await call('POST', '/admin/map-packs', body);
  if (result.status === 201 || result.status === 200) {
    const pack = result.json.data.mapPack;
    console.error(
      `✓ registered: map pack ${pack.id}, version ${pack.version}; publish it in the console`,
    );
  } else if (codeOf(result) === 'MAP_PACK_ALREADY_REGISTERED') {
    console.error(`✓ already registered: ${result.json.error.details.mapPackId}`);
  } else {
    const details = result.json?.error?.details;
    throw new Error(
      `registering failed: ${codeOf(result)}${details === undefined ? '' : ` ${JSON.stringify(details)}`}`,
    );
  }
} catch (error) {
  failed = true;
  console.error(`✗ ${error.message} (${where})`);
} finally {
  if (signedIn) {
    const logout = await call('POST', '/auth/logout', {});
    if (logout.status !== 204) console.error(`✗ signing out failed: ${codeOf(logout)}`);
  }
}
process.exit(failed ? 1 : 0);
