// node infra/tiles/upload.mjs --out <dir> --area <code> --area-id <uuid> --basemaps <package dir>
//
// The second half of `pnpm tiles:build` (architecture §6): writes the style with absolute URLs
// under GCS_PUBLIC_BASE_URL, hashes every object, refuses a pack over MAX_MAP_PACK_BYTES, uploads
// everything under `maps/<areaCode>/<buildId>/` (buildId: the archive's SHA-256, first 16 hex
// characters) and prints the `POST /admin/map-packs` body. Storage settings are catalog's, read
// from services/catalog/.env.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const catalogDir = join(root, 'services/catalog');
// catalog's own dependencies: the storage client, dotenv, and the contracts' limits.
const requireFromCatalog = createRequire(join(catalogDir, 'package.json'));
const { Storage } = requireFromCatalog('@google-cloud/storage');
const { parse } = requireFromCatalog('dotenv');
const { MAX_MAP_PACK_BYTES, mapPackBuildId, mapPackPrefix } =
  requireFromCatalog('@wayfare/contracts');

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .flatMap((arg, index, all) => (arg.startsWith('--') ? [[arg.slice(2), all[index + 1]]] : [])),
);
for (const name of ['out', 'area', 'area-id', 'basemaps']) {
  if (!args[name]) throw new Error(`--${name} is required`);
}
const versions = parse(readFileSync(join(here, 'versions.env')));
const env = parse(readFileSync(join(catalogDir, '.env')));
let baseEnd = env.GCS_PUBLIC_BASE_URL.length;
while (baseEnd > 0 && env.GCS_PUBLIC_BASE_URL[baseEnd - 1] === '/') baseEnd--;
const base = env.GCS_PUBLIC_BASE_URL.slice(0, baseEnd);

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const archive = readFileSync(join(args.out, 'map.pmtiles'));
const prefix = mapPackPrefix(args.area, mapPackBuildId(sha256(archive)));

// The styles: the pinned flavours' layers over the archive, every URL absolute (architecture §6).
// The web client registers the `pmtiles://` protocol; the mobile client swaps `base` for the
// pack's local directory at activation.
const basemaps = createRequire(join(args.basemaps, 'package.json'))(
  join(args.basemaps, 'dist/cjs/index.cjs'),
);
/** One flavour's style over the shared archive and glyphs; its sprites are its own. */
const styleOf = (flavor) => ({
  version: 8,
  name: `${args.area} ${flavor} (Protomaps ${versions.PROTOMAPS_BUILD_DATE})`,
  glyphs: `${base}/${prefix}fonts/{fontstack}/{range}.pbf`,
  sprite: `${base}/${prefix}sprites/v4/${flavor}`,
  sources: {
    protomaps: {
      type: 'vector',
      url: `pmtiles://${base}/${prefix}map.pmtiles`,
      attribution:
        '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>',
    },
  },
  layers: basemaps.layers('protomaps', basemaps.namedFlavor(flavor), {
    lang: versions.BASEMAPS_LANG,
  }),
});
writeFileSync(join(args.out, 'style.json'), JSON.stringify(styleOf(versions.BASEMAPS_FLAVOR)));
writeFileSync(
  join(args.out, 'style-dark.json'),
  JSON.stringify(styleOf(versions.BASEMAPS_DARK_FLAVOR)),
);

/** Every file below a directory, as paths relative to it. */
function files(dir) {
  return readdirSync(dir, { recursive: true })
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isFile() && !path.endsWith('register.json'));
}

const objects = files(args.out)
  .map((path) => {
    const data = readFileSync(path);
    return {
      file: path,
      path: `${prefix}${relative(args.out, path)}`,
      sha256: sha256(data),
      bytes: data.length,
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));
const total = objects.reduce((sum, object) => sum + object.bytes, 0);
if (total > MAX_MAP_PACK_BYTES) {
  console.error(
    `✗ the pack weighs ${total} bytes, over MAX_MAP_PACK_BYTES (${MAX_MAP_PACK_BYTES})`,
  );
  process.exit(1);
}

const contentType = (path) =>
  path.endsWith('.json')
    ? 'application/json'
    : path.endsWith('.png')
      ? 'image/png'
      : path.endsWith('.pbf')
        ? 'application/x-protobuf'
        : 'application/vnd.pmtiles';
const storage = new Storage({
  ...(env.GCS_API_ENDPOINT ? { apiEndpoint: env.GCS_API_ENDPOINT } : {}),
  ...(env.GOOGLE_APPLICATION_CREDENTIALS
    ? { keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS }
    : {}),
});
const bucket = storage.bucket(env.GCS_BUCKET_MEDIA);
for (const object of objects) {
  await bucket.upload(object.file, {
    destination: object.path,
    resumable: false,
    contentType: contentType(object.path),
    metadata: { cacheControl: 'public, max-age=31536000, immutable' },
  });
}
console.error(
  `✓ uploaded ${objects.length} objects, ${total} bytes, to ${env.GCS_BUCKET_MEDIA}/${prefix}`,
);

const pick = ({ path, sha256: hash, bytes }) => ({ path, sha256: hash, bytes });
const date = versions.PROTOMAPS_BUILD_DATE;
const body = {
  areaId: args['area-id'],
  pmtiles: pick(objects.find((object) => object.path === `${prefix}map.pmtiles`)),
  style: pick(objects.find((object) => object.path === `${prefix}style.json`)),
  styleDark: pick(objects.find((object) => object.path === `${prefix}style-dark.json`)),
  assets: objects
    .filter(
      (object) =>
        !object.path.endsWith('map.pmtiles') && !/\/style(-dark)?\.json$/.test(object.path),
    )
    .map(pick),
  source: `protomaps-${date}`,
  sourceDate: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
  minZoom: Number(versions.MIN_ZOOM),
  maxZoom: Number(versions.MAX_ZOOM),
  buildTool: `pmtiles ${versions.PMTILES_VERSION}`,
};
writeFileSync(join(args.out, 'register.json'), JSON.stringify(body, null, 2));
console.log(JSON.stringify(body));
