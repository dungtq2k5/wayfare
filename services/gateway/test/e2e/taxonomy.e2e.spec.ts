// `/admin/categories` and `/admin/areas` (api-endpoints-plan §3.6): who may call them, what the
// gateway refuses before catalog, what it forwards, and how catalog's refusals map.
import { status } from '@grpc/grpc-js';
import { CategoryAppliesTo, newId } from '@wayfare/contracts';
import type { catalogGrpc } from '@wayfare/contracts/grpc';
import { categoryAppliesToProto } from '@wayfare/contracts/grpc';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const staff = (perms: string[]) => `wf_at=${accountToken({ userId: newId(), perms })}`;
const manage = () => staff(['catalog.taxonomy.manage']);
const call = (method: 'get' | 'post' | 'patch', path: string, cookie: string) => {
  const agent = request(gateway.app.getHttpServer());
  return agent[method](`/api/v1${path}`).set('X-Wayfare-Client', 'console').set('Cookie', cookie);
};

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => gateway.catalog.reset());

const ring: [number, number][] = [
  [106.683, 10.776],
  [106.689, 10.776],
  [106.689, 10.782],
  [106.683, 10.782],
  [106.683, 10.776],
];

function category(over: Partial<catalogGrpc.AdminCategory> = {}): catalogGrpc.AdminCategory {
  return {
    id: newId(),
    code: 'WALK_BAKERY',
    appliesTo: categoryAppliesToProto.toProto(CategoryAppliesTo.VENUE),
    icon: 'bakery',
    sortOrder: 110,
    isActive: true,
    placeCount: 0,
    ...over,
  };
}

function area(over: Partial<catalogGrpc.AdminArea> = {}): catalogGrpc.AdminArea {
  return {
    id: newId(),
    code: 'walk-d3',
    nameVi: 'Khu thử Quận 3',
    boundaryGeojson: JSON.stringify({ type: 'Polygon', coordinates: [ring] }),
    center: { lat: 10.779, lng: 106.686 },
    defaultZoom: 16,
    sortOrder: 5,
    isActive: true,
    placeCounts: { draft: 1, processing: 0, active: 2, inactive: 0 },
    ...over,
  };
}

describe('/admin/categories', () => {
  it('lists, creates and edits under catalog.taxonomy.manage', async () => {
    gateway.catalog.taxonomyAdmin.handlers.listAdminCategories = () =>
      Promise.resolve({ categories: [category({ code: 'MARKET', placeCount: 3 })] });
    const list = await call('get', '/admin/categories', manage());
    expect(list.status).toBe(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({ code: 'MARKET', appliesTo: 'VENUE', placeCount: 3 }),
    ]);

    gateway.catalog.taxonomyAdmin.handlers.createCategory = () =>
      Promise.resolve({ category: category() });
    const created = await call('post', '/admin/categories', manage()).send({
      code: 'WALK_BAKERY',
      appliesTo: 'VENUE',
      icon: 'bakery',
      sortOrder: 110,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.category).toMatchObject({ code: 'WALK_BAKERY', isActive: true });

    const id = newId();
    gateway.catalog.taxonomyAdmin.handlers.updateCategory = () =>
      Promise.resolve({ category: category({ id, isActive: false }) });
    const edited = await call('patch', `/admin/categories/${id}`, manage()).send({
      isActive: false,
    });
    expect(edited.status).toBe(200);
    expect(gateway.catalog.taxonomyAdmin.calls.at(-1)!.request).toEqual({
      categoryId: id,
      isActive: false,
    });
    expect((await call('get', '/admin/categories', staff(['place.read']))).status).toBe(403);
  });

  it('refuses a malformed body, and a code in an edit, before catalog', async () => {
    for (const body of [
      { code: 'bakery', appliesTo: 'VENUE', icon: 'bakery', sortOrder: 1 },
      { code: 'WALK_X', appliesTo: 'SHOP', icon: 'bakery', sortOrder: 1 },
    ]) {
      expect((await call('post', '/admin/categories', manage()).send(body)).status).toBe(400);
    }
    const edit = await call('patch', `/admin/categories/${newId()}`, manage()).send({
      code: 'RENAMED',
    });
    expect(edit.status).toBe(400);
    expect(gateway.catalog.taxonomyAdmin.calls).toEqual([]);
  });
});

describe('/admin/areas', () => {
  it('lists, reads, creates and edits, with the boundary as GeoJSON and the counts by status', async () => {
    gateway.catalog.taxonomyAdmin.handlers.listAdminAreas = () =>
      Promise.resolve({ areas: [area()] });
    const list = await call('get', '/admin/areas', manage());
    expect(list.status).toBe(200);
    expect(list.body.data[0]).toMatchObject({
      code: 'walk-d3',
      boundary: { type: 'Polygon', coordinates: [ring] },
      placeCounts: { DRAFT: 1, PROCESSING: 0, ACTIVE: 2, INACTIVE: 0 },
    });

    gateway.catalog.taxonomyAdmin.handlers.getAdminArea = () => Promise.resolve({ area: area() });
    expect((await call('get', `/admin/areas/${newId()}`, manage())).status).toBe(200);

    gateway.catalog.taxonomyAdmin.handlers.createArea = () => Promise.resolve({ area: area() });
    const created = await call('post', '/admin/areas', manage()).send({
      code: 'walk-d3',
      nameVi: 'Khu thử Quận 3',
      boundary: { type: 'Polygon', coordinates: [ring] },
      center: { lat: 10.779, lng: 106.686 },
      defaultZoom: 16,
      sortOrder: 5,
      isActive: true,
    });
    expect(created.status).toBe(201);
    const sent = gateway.catalog.taxonomyAdmin.calls.at(-1)!
      .request as catalogGrpc.CreateAreaRequest;
    expect(JSON.parse(sent.boundaryGeojson)).toEqual({ type: 'Polygon', coordinates: [ring] });

    const id = newId();
    gateway.catalog.taxonomyAdmin.handlers.updateArea = () =>
      Promise.resolve({ area: area({ id, isActive: false }) });
    const edited = await call('patch', `/admin/areas/${id}`, manage()).send({ isActive: false });
    expect(edited.status).toBe(200);
    expect(gateway.catalog.taxonomyAdmin.calls.at(-1)!.request).toEqual({
      areaId: id,
      center: undefined,
      isActive: false,
    });
  });

  it('refuses an unclosed ring, a zoom out of range and a code in an edit before catalog', async () => {
    const body = {
      code: 'walk-d3',
      nameVi: 'Khu thử',
      boundary: { type: 'Polygon', coordinates: [ring.slice(0, 4)] },
      center: { lat: 10.779, lng: 106.686 },
      defaultZoom: 16,
      sortOrder: 5,
      isActive: true,
    };
    const unclosed = await call('post', '/admin/areas', manage()).send(body);
    expect(unclosed.status).toBe(400);
    expect(unclosed.body.error.details.issues).toEqual([
      expect.objectContaining({ path: '/boundary/coordinates/0' }),
    ]);
    const zoom = await call('post', '/admin/areas', manage()).send({
      ...body,
      boundary: { type: 'Polygon', coordinates: [ring] },
      defaultZoom: 19,
    });
    expect(zoom.status).toBe(400);
    expect(
      (await call('patch', `/admin/areas/${newId()}`, manage()).send({ code: 'renamed' })).status,
    ).toBe(400);
    expect(gateway.catalog.taxonomyAdmin.calls).toEqual([]);
  });

  it.each([
    ['AREA_OVERLAPS', { codes: ['hcmc-d1-core'] }],
    ['AREA_EXCLUDES_PLACES', { count: 1, placeIds: [newId()] }],
    ['AREA_HAS_LIVE_PLACES', { count: 12 }],
  ])('passes %s through as a 409 with its details', async (code, details) => {
    gateway.catalog.taxonomyAdmin.handlers.updateArea = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': code,
          'wf-error-details': JSON.stringify(details),
        }),
      );
    const res = await call('patch', `/admin/areas/${newId()}`, manage()).send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code, details });
  });
});
