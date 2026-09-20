// Map pack registration and publication (api-endpoints-plan §3.6, rdm-spec C-14): every object
// under its build's prefix and re-hashed from the bucket, the version the server's, and one
// published pack per area. The server never parses PMTiles, so the objects are arbitrary bytes.
import { createHash, randomBytes } from 'node:crypto';
import { AUDIT_RECORD, AuditAction, MAX_MAP_PACK_BYTES, MapPackStatus } from '@wayfare/contracts';
import { mapPackStatusProto } from '@wayfare/contracts/grpc';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { buildAccountContext } from '@wayfare/nest-common/testing';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testPrisma, truncateAll } from '../setup/database';
import { device, errorOf, outboxPayloads, taxonomy } from '../setup/fixtures';
import { catalogServices } from '../setup/services';

const prisma = testPrisma();
let services: ReturnType<typeof catalogServices>;
let tax: Awaited<ReturnType<typeof taxonomy>>;
const admin = () => buildAccountContext({ permissions: ['map_pack.manage'] });

beforeEach(async () => {
  await truncateAll(prisma);
  services = catalogServices(prisma);
  tax = await taxonomy(prisma);
});
afterAll(() => prisma.$disconnect());

const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** A build uploaded under its prefix: an archive, a style and two glyph files. */
async function uploadBuild(areaCode = tax.area.code) {
  const archive = randomBytes(40_000);
  const buildId = sha(archive).slice(0, 16);
  const prefix = `maps/${areaCode}/${buildId}/`;
  const files: [string, Buffer][] = [
    [`${prefix}map.pmtiles`, archive],
    [`${prefix}style.json`, Buffer.from('{"version":8}')],
    [`${prefix}fonts/Noto_Sans_Regular/0-255.pbf`, randomBytes(3_000)],
    [`${prefix}fonts/Noto_Sans_Regular/7680-7935.pbf`, randomBytes(2_000)],
  ];
  for (const [path, data] of files) {
    await services.storage.upload(path, data, {
      contentType: 'application/octet-stream',
      cacheControl: 'public, max-age=31536000, immutable',
    });
  }
  const [pmtiles, style, ...assets] = files.map(([path, data]) => ({
    path,
    sha256: sha(data),
    bytes: String(data.length),
  }));
  const request: catalogGrpc.RegisterMapPackRequest = {
    areaId: tax.area.id,
    pmtiles,
    style,
    assets,
    source: 'protomaps-20260915',
    sourceDate: '2026-09-15',
    minZoom: 10,
    maxZoom: 15,
    buildTool: 'pmtiles 1.28.0',
  };
  return { request, prefix, archive };
}

const register = (request: catalogGrpc.RegisterMapPackRequest) =>
  services.mapPacks.registerMapPack(request, admin());
const publish = (mapPackId: string) => services.mapPacks.publishMapPack({ mapPackId }, admin());

describe('registering a map pack', () => {
  it('re-hashes every object, assigns the next version and audits it', async () => {
    const { request } = await uploadBuild();
    const { mapPack } = await register(request);
    expect(mapPack).toMatchObject({
      areaId: tax.area.id,
      version: 1,
      status: mapPackStatusProto.toProto(MapPackStatus.BUILDING),
      pmtiles: request.pmtiles,
      assets: request.assets,
      minZoom: 10,
      maxZoom: 15,
    });
    expect(Number(mapPack!.totalBytes)).toBe(40_000 + 13 + 3_000 + 2_000);
    const again = await register((await uploadBuild()).request);
    expect(again.mapPack!.version).toBe(2);
    const audits = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter(
      (row) => row.action === AuditAction.MAP_PACK_REGISTERED,
    );
    expect(audits[0]).toMatchObject({
      resource: { type: 'MAP_PACK', id: mapPack!.id },
      metadata: { after: { areaId: tax.area.id, version: 1, pmtilesBytes: 40_000 } },
    });
  });

  it('refuses a changed or missing object, a path outside the build, and an oversize pack', async () => {
    const { request, prefix } = await uploadBuild();
    await services.storage.upload(request.pmtiles!.path, randomBytes(40_000), {
      contentType: 'application/octet-stream',
      cacheControl: 'no-store',
    });
    expect(await errorOf(register(request))).toEqual({
      code: 'MAP_PACK_HASH_MISMATCH',
      details: { path: request.pmtiles!.path },
    });

    const build = await uploadBuild();
    const fresh = build.request;
    const missing = { ...fresh.assets[0]!, path: `${build.prefix}sprites/v4/light.png` };
    expect(await errorOf(register({ ...fresh, assets: [...fresh.assets, missing] }))).toEqual({
      code: 'MAP_PACK_OBJECT_MISSING',
      details: { path: missing.path },
    });

    const elsewhere = { ...fresh.style!, path: `photos/${prefix.split('/')[2]!}/style.json` };
    expect(await errorOf(register({ ...fresh, style: elsewhere }))).toEqual({
      code: 'VALIDATION_FAILED',
      details: { issues: [{ path: '/style/path', code: 'outside_build_prefix' }] },
    });
    const otherArea = {
      ...fresh.style!,
      path: fresh.style!.path.replace(tax.area.code, 'hcmc-other'),
    };
    expect((await errorOf(register({ ...fresh, style: otherArea }))).code).toBe(
      'VALIDATION_FAILED',
    );

    const heavy = { ...fresh.pmtiles!, bytes: String(MAX_MAP_PACK_BYTES) };
    expect(await errorOf(register({ ...fresh, pmtiles: heavy }))).toEqual({
      code: 'MAP_PACK_TOO_LARGE',
      details: { bytes: MAX_MAP_PACK_BYTES + 13 + 3_000 + 2_000, maxBytes: MAX_MAP_PACK_BYTES },
    });
    expect((await errorOf(register({ ...fresh, maxZoom: 9 }))).code).toBe('VALIDATION_FAILED');
    expect(await prisma.mapPack.count()).toBe(0);
  });
});

describe('publishing a map pack', () => {
  it('publishes, retires the previous one, and shows the live pack on /areas', async () => {
    const first = (await register((await uploadBuild()).request)).mapPack!;
    expect(
      (await services.queries.listAreas({}, device())).areas.find((a) => a.id === tax.area.id)!
        .mapPack,
    ).toBeUndefined();
    const { mapPack } = await publish(first.id);
    expect(mapPack!.status).toBe(mapPackStatusProto.toProto(MapPackStatus.PUBLISHED));
    expect(await publish(first.id)).toEqual({ mapPack });

    const second = (await register((await uploadBuild()).request)).mapPack!;
    await publish(second.id);
    const rows = await prisma.mapPack.findMany({ orderBy: { version: 'asc' } });
    expect(rows.map((row) => row.status)).toEqual([MapPackStatus.RETIRED, MapPackStatus.PUBLISHED]);
    expect(rows[0]!.retiredAt).not.toBeNull();
    expect((await errorOf(publish(first.id))).code).toBe('INVALID_STATE');

    const area = (await services.queries.listAreas({}, device())).areas.find(
      (a) => a.id === tax.area.id,
    )!;
    expect(area.mapPack).toEqual({ version: 2, bytes: second.totalBytes });
    const audits = (await outboxPayloads(prisma, AUDIT_RECORD.subject)).filter(
      (row) => row.action === AuditAction.MAP_PACK_PUBLISHED,
    );
    expect(audits.map((row) => row.metadata)).toEqual([
      { before: { previousVersion: null }, after: { version: 1 } },
      { before: { previousVersion: 1 }, after: { version: 2 } },
    ]);
  });
});
