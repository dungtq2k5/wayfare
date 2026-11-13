// The map packs the screens' Places draw on, one for each seeded area: registered and published as
// an admin would, so every machine draws the same structure — the map, then its fields — rather than the
// no-pack line on one and a map on another. Its canvas is masked in every baseline, so the pack is
// a small fixed stand-in uploaded here (an empty style per scheme), not `pnpm tiles:build`:
// that downloads the pinned Protomaps build, which Protomaps removes after a while.
import { createHash } from 'node:crypto';
import type { Actor } from '../support/stack';
import { SCREENS_STACK } from '../support/stack';

const BUCKET = 'wayfare-media-local';
/** The media emulator's API, as the stack publishes it. */
const STORAGE = `http://localhost:${SCREENS_STACK ? 24443 : 4443}`;

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** A style with nothing to draw: the canvas is masked in every baseline. */
const style = (name: string) =>
  Buffer.from(JSON.stringify({ version: 8, name, sources: {}, layers: [] }));

async function put(path: string, bytes: Buffer, contentType: string): Promise<void> {
  const response = await fetch(
    `${STORAGE}/upload/storage/v1/b/${BUCKET}/o?uploadType=media&name=${encodeURIComponent(path)}`,
    { method: 'POST', headers: { 'content-type': contentType }, body: new Uint8Array(bytes) },
  );
  if (!response.ok) throw new Error(`upload ${path} → ${response.status}`);
}

/** The area whose packs round 35's A5 draws: a published version, and one being built after it. */
export const PACKS_AREA = 'hcmc-d1-core';

/**
 * Uploads, registers and publishes each area's pack, unless one is published already; District 1
 * also gets a second version, registered and not published (A5's *Building* row).
 */
export async function publishMapPacks(admin: Actor): Promise<void> {
  const { data: areas } = await admin.call<{
    data: { id: string; code: string; mapPack: unknown }[];
  }>('GET', '/areas');
  for (const area of areas) {
    if (area.mapPack != null) continue;
    await registerMapPack(admin, area, 'v1', true);
    if (area.code === PACKS_AREA) await registerMapPack(admin, area, 'v2', false);
  }
}

/** Uploads and registers one version of an area's pack, as the tiles build does; publishes it when asked. */
export async function registerMapPack(
  admin: Actor,
  area: { id: string; code: string },
  edition: string,
  publish: boolean,
): Promise<void> {
  const archive = Buffer.from(`screens stand-in for ${area.code}'s map pack, ${edition}`);
  const prefix = `maps/${area.code}/${sha256(archive).slice(0, 16)}/`;
  const objects = {
    pmtiles: { path: `${prefix}map.pmtiles`, bytes: archive, type: 'application/octet-stream' },
    style: {
      path: `${prefix}style.json`,
      bytes: style('light'),
      type: 'application/json',
    },
    styleDark: {
      path: `${prefix}style-dark.json`,
      bytes: style('dark'),
      type: 'application/json',
    },
  };
  for (const object of Object.values(objects)) await put(object.path, object.bytes, object.type);
  const described = (object: { path: string; bytes: Buffer }) => ({
    path: object.path,
    sha256: sha256(object.bytes),
    bytes: object.bytes.length,
  });
  const { data } = await admin.call<{ data: { mapPack: { id: string } } }>(
    'POST',
    '/admin/map-packs',
    {
      areaId: area.id,
      pmtiles: described(objects.pmtiles),
      style: described(objects.style),
      styleDark: described(objects.styleDark),
      assets: [],
      source: 'screens-stand-in',
      sourceDate: '2026-10-01',
      minZoom: 10,
      maxZoom: 15,
      buildTool: 'apps/console/e2e/screens',
    },
  );
  if (publish) await admin.call('POST', `/admin/map-packs/${data.mapPack.id}/publish`);
}
