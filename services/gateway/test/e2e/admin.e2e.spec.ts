import { status } from '@grpc/grpc-js';
import { newId } from '@wayfare/contracts';
import {
  adminUserDetailFixture,
  adminUserFixture,
  auditLogEntryFixture,
  FIXTURE_ROLE_ID,
  roleFixture,
} from '@wayfare/contracts/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();
const userId = newId();
const cookie = (perms: string[]) => `wf_at=${accountToken({ userId, perms })}`;

const EVERY = [
  'user.read',
  'user.create',
  'user.update',
  'user.delete',
  'user.lock',
  'user.role.assign',
  'role.read',
  'role.create',
  'role.update',
  'role.delete',
  'audit.read',
];

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/** A console request, anonymous unless `perms` is given. */
function open(method: Method, path: string) {
  const agent = request(server());
  return agent[method](`/api/v1${path}`).set('X-Wayfare-Client', 'console');
}

function call(method: Method, path: string, perms: string[] = EVERY) {
  return open(method, path).set('Cookie', cookie(perms));
}

const id = newId();
const window = () => {
  const to = new Date();
  const from = new Date(to.getTime() - 3_600_000);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
};

beforeAll(async () => {
  gateway = await bootGateway();
});

afterAll(() => gateway.app.close());

beforeEach(() => {
  gateway.identity.reset();
  gateway.redis.values.clear();
  const { adminUsers, roles, audit } = gateway.identity;
  adminUsers.handlers.listUsers = () =>
    Promise.resolve({
      users: [
        { user: adminUserFixture() },
        { erased: { id: newId(), erasedAt: { seconds: '1700000000', nanos: 0 } } },
      ],
      page: { page: 1, pageSize: 20, total: 2 },
    });
  adminUsers.handlers.getUser = () =>
    Promise.resolve({ user: adminUserDetailFixture({ lockReason: undefined }) });
  const withUser = () => Promise.resolve({ user: adminUserFixture() });
  adminUsers.handlers.createStaffUser = withUser;
  adminUsers.handlers.updateUser = withUser;
  adminUsers.handlers.setUserRoles = withUser;
  for (const method of [
    'lockUser',
    'unlockUser',
    'deactivateUser',
    'restoreUser',
    'revokeUserSessions',
  ]) {
    adminUsers.handlers[method] = () => Promise.resolve({});
  }
  const withRole = () => Promise.resolve({ role: roleFixture() });
  roles.handlers.listRoles = () => Promise.resolve({ roles: [roleFixture()] });
  roles.handlers.createRole = withRole;
  roles.handlers.updateRole = withRole;
  roles.handlers.setRolePermissions = withRole;
  roles.handlers.deleteRole = () => Promise.resolve({});
  roles.handlers.listPermissions = () =>
    Promise.resolve({
      groups: [
        {
          group: 'USERS',
          permissions: [{ code: 'user.read', description: 'View accounts.', isRetired: false }],
        },
      ],
    });
  audit.handlers.listAuditLogs = () =>
    Promise.resolve({ entries: [auditLogEntryFixture()], page: { nextCursor: 'next' } });
  audit.handlers.listAuditActions = () => Promise.resolve({ actions: ['A_ACTION', 'B_ACTION'] });
});

/** Every route, its permission, and a valid request. */
const ROUTES: [Method, string, string, object | undefined][] = [
  ['get', '/admin/users', 'user.read', undefined],
  ['get', `/admin/users/${id}`, 'user.read', undefined],
  [
    'post',
    '/admin/users',
    'user.create',
    { email: 'new@example.com', fullName: 'New', roleIds: [FIXTURE_ROLE_ID] },
  ],
  ['patch', `/admin/users/${id}`, 'user.update', { fullName: 'Renamed' }],
  ['put', `/admin/users/${id}/roles`, 'user.role.assign', { roleIds: [] }],
  ['post', `/admin/users/${id}/lock`, 'user.lock', { reason: 'check' }],
  ['post', `/admin/users/${id}/unlock`, 'user.lock', undefined],
  ['delete', `/admin/users/${id}`, 'user.delete', { reason: 'left' }],
  ['post', `/admin/users/${id}/restore`, 'user.delete', undefined],
  ['delete', `/admin/users/${id}/sessions`, 'user.lock', undefined],
  ['get', '/admin/roles', 'role.read', undefined],
  ['post', '/admin/roles', 'role.create', { name: 'Support', permissionCodes: ['user.read'] }],
  ['patch', `/admin/roles/${id}`, 'role.update', { name: 'Help' }],
  ['put', `/admin/roles/${id}/permissions`, 'role.update', { permissionCodes: [] }],
  ['delete', `/admin/roles/${id}`, 'role.delete', undefined],
  ['get', '/admin/permissions', 'role.read', undefined],
  ['get', '/admin/audit-logs?WINDOW', 'audit.read', undefined],
  ['get', '/admin/audit-logs/actions', 'audit.read', undefined],
];

const pathOf = (path: string) => path.replace('WINDOW', window());

describe('admin routes', () => {
  it.each(ROUTES)(
    '%s %s requires %s, answers without caching, and passes with it',
    async (method, path, permission, body) => {
      const others = EVERY.filter((code) => code !== permission);
      const refused = await call(method, pathOf(path), others).send(body);
      expect(refused.status).toBe(403);
      expect(refused.body.error).toMatchObject({
        code: 'PERMISSION_DENIED',
        details: { required: [permission] },
      });

      const anonymous = await open(method, pathOf(path)).send(body);
      expect(anonymous.status).toBe(401);

      const res = await call(method, pathOf(path), [permission]).send(body);
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
      expect(res.headers['cache-control']).toBe('private, no-store');
    },
  );
});

describe('/admin/users', () => {
  it('lists a page with the erased placeholder as a discriminated item', async () => {
    const res = await call('get', '/admin/users?q=staff&isLocked=false&sort=email');
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 2 });
    expect(res.body.data[0]).toMatchObject({
      erased: false,
      email: 'staff@example.com',
      lockedUntil: null,
      lastLoginAt: null,
      deletedAt: null,
    });
    expect(res.body.data[1]).toEqual({
      erased: true,
      id: expect.any(String) as unknown,
      erasedAt: '2023-11-14T22:13:20.000Z',
    });
    expect(gateway.identity.adminUsers.calls[0]?.request).toEqual({
      page: { page: 1, pageSize: 20, sort: 'email', q: 'staff' },
      isLocked: false,
      includeDeleted: false,
    });
  });

  it('refuses an unlisted sort, a bad boolean and a non-v7 role id', async () => {
    for (const query of ['sort=passwordHash', 'isLocked=yes', `roleId=${'0'.repeat(8)}`]) {
      const res = await call('get', `/admin/users?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('shows the detail with sessions by client and no owner registration yet', async () => {
    const res = await call('get', `/admin/users/${id}`);
    expect(res.body.data).toMatchObject({
      erased: false,
      devicesCount: 1,
      sessions: { live: 2, byClient: { CONSOLE: 1, WEB: 0, MOBILE: 1 } },
      lockReason: null,
      ownerRegistration: null,
    });
    const bad = await call('get', '/admin/users/not-a-uuid');
    expect(bad.status).toBe(400);
  });

  it('creates staff with a de-duplicated role set, and refuses an empty one', async () => {
    const res = await call('post', '/admin/users').send({
      email: ' New@Example.com ',
      fullName: 'New',
      roleIds: [FIXTURE_ROLE_ID, FIXTURE_ROLE_ID],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.erased).toBe(false);
    expect(gateway.identity.adminUsers.calls[0]?.request).toEqual({
      email: 'new@example.com',
      fullName: 'New',
      roleIds: [FIXTURE_ROLE_ID],
    });
    const empty = await call('post', '/admin/users').send({
      email: 'x@example.com',
      fullName: 'X',
      roleIds: [],
    });
    expect(empty.status).toBe(400);
  });

  it("passes identity's refusals through with their details", async () => {
    gateway.identity.adminUsers.handlers.setUserRoles = () =>
      Promise.reject(
        serviceError(status.PERMISSION_DENIED, {
          'wf-error-code': 'PERMISSION_DENIED',
          'wf-error-details': JSON.stringify({ required: ['role.update'] }),
        }),
      );
    const denied = await call('put', `/admin/users/${id}/roles`).send({ roleIds: [] });
    expect(denied.status).toBe(403);
    expect(denied.body.error.details).toEqual({ required: ['role.update'] });

    gateway.identity.adminUsers.handlers.lockUser = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, { 'wf-error-code': 'LAST_SUPER_ADMIN' }),
      );
    const last = await call('post', `/admin/users/${id}/lock`).send({ reason: 'x' });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('LAST_SUPER_ADMIN');

    gateway.identity.adminUsers.handlers.deactivateUser = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'OWNER_HAS_LIVE_VOUCHERS',
          'wf-error-details': JSON.stringify({ issuedVoucherCount: 2, openCheckoutCount: 0 }),
        }),
      );
    const owner = await call('delete', `/admin/users/${id}`).send({ reason: 'x' });
    expect(owner.status).toBe(409);
    expect(owner.body.error.details).toEqual({ issuedVoucherCount: 2, openCheckoutCount: 0 });
  });

  it('bounds a lock: a reason, and an expiry in the future within a year', async () => {
    const lock = (body: object) => call('post', `/admin/users/${id}/lock`).send(body);
    expect((await lock({})).status).toBe(400);
    expect((await lock({ reason: 'x'.repeat(256) })).status).toBe(400);
    expect((await lock({ reason: 'x', lockedUntil: '2020-01-01T00:00:00Z' })).status).toBe(400);
    const far = new Date(Date.now() + 400 * 86_400_000).toISOString();
    expect((await lock({ reason: 'x', lockedUntil: far })).status).toBe(400);
    const soon = new Date(Date.now() + 86_400_000);
    expect((await lock({ reason: 'x', lockedUntil: soon.toISOString() })).status).toBe(204);
    const sent = gateway.identity.adminUsers.calls.at(-1)?.request as {
      lockedUntil: { seconds: string };
    };
    expect(Number(sent.lockedUntil.seconds)).toBe(Math.floor(soon.getTime() / 1000));
  });

  it('bounds a deactivation reason at 500 and defaults the refund to false', async () => {
    const tooLong = await call('delete', `/admin/users/${id}`).send({ reason: 'x'.repeat(501) });
    expect(tooLong.status).toBe(400);
    const res = await call('delete', `/admin/users/${id}`).send({ reason: 'x'.repeat(500) });
    expect(res.status).toBe(204);
    expect(gateway.identity.adminUsers.calls.at(-1)?.request).toEqual({
      userId: id,
      reason: 'x'.repeat(500),
      refundUnredeemedVouchers: false,
    });
  });
});

describe('/admin/roles and /admin/permissions', () => {
  it('lists roles and the catalogue as bare arrays', async () => {
    const roles = await call('get', '/admin/roles');
    expect(roles.body).toEqual({
      data: [
        {
          id: FIXTURE_ROLE_ID,
          code: 'CUSTOM_SUPPORT',
          name: 'Support',
          description: null,
          isSystem: false,
          permissionCodes: ['audit.read', 'user.read'],
          holders: 0,
        },
      ],
    });
    const permissions = await call('get', '/admin/permissions');
    expect(permissions.body.data[0].group).toBe('USERS');
  });

  it('sends a well-formed unknown code on to identity, and refuses a malformed one', async () => {
    const res = await call('post', '/admin/roles').send({
      name: 'Support',
      permissionCodes: ['future.permission', 'future.permission'],
    });
    expect(res.status).toBe(201);
    expect(gateway.identity.roles.calls[0]?.request).toEqual({
      name: 'Support',
      permissionCodes: ['future.permission'],
    });
    const bad = await call('post', '/admin/roles').send({
      name: 'Support',
      permissionCodes: ['Not A Code'],
    });
    expect(bad.status).toBe(400);
  });

  it('clears a description with null', async () => {
    await call('patch', `/admin/roles/${id}`).send({ description: null });
    expect(gateway.identity.roles.calls[0]?.request).toEqual({ roleId: id, description: '' });
  });

  it('passes ROLE_IN_USE and ROLE_TOO_WIDE_TO_EDIT through with their details', async () => {
    gateway.identity.roles.handlers.deleteRole = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'ROLE_IN_USE',
          'wf-error-details': JSON.stringify({ holders: 3 }),
        }),
      );
    const inUse = await call('delete', `/admin/roles/${id}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.details).toEqual({ holders: 3 });
    gateway.identity.roles.handlers.setRolePermissions = () =>
      Promise.reject(
        serviceError(status.FAILED_PRECONDITION, {
          'wf-error-code': 'ROLE_TOO_WIDE_TO_EDIT',
          'wf-error-details': JSON.stringify({ holders: 501, limit: 500 }),
        }),
      );
    const wide = await call('put', `/admin/roles/${id}/permissions`).send({
      permissionCodes: [],
    });
    expect(wide.status).toBe(409);
    expect(wide.body.error.details).toEqual({ holders: 501, limit: 500 });
  });
});

describe('/admin/audit-logs', () => {
  it('lists a cursor page with parsed metadata', async () => {
    const res = await call('get', `/admin/audit-logs?${window()}&action=RETIRED_ACTION&limit=5`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ nextCursor: 'next' });
    expect(res.body.data[0]).toMatchObject({
      actor: { type: 'USER', deviceId: null },
      action: 'USER_LOCKED',
      resource: { type: 'USER' },
      metadata: { after: { lockedUntil: null }, reason: 'check' },
      ip: null,
    });
    expect(gateway.identity.audit.calls[0]?.request).toMatchObject({
      page: { limit: 5 },
      action: 'RETIRED_ACTION',
    });
  });

  it('refuses a missing, inverted or 94-day window, and an unknown resource type', async () => {
    const to = new Date();
    const at = (ms: number) => encodeURIComponent(new Date(ms).toISOString());
    const queries = [
      '',
      `from=${at(to.getTime())}&to=${at(to.getTime() - 1000)}`,
      `from=${at(to.getTime() - 94 * 86_400_000)}&to=${at(to.getTime())}`,
      `${window()}&resourceType=SPACESHIP`,
      `${window()}&action=lower`,
    ];
    for (const query of queries) {
      const res = await call('get', `/admin/audit-logs?${query}`);
      expect(res.status, query).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    const exact = await call(
      'get',
      `/admin/audit-logs?from=${at(to.getTime() - 93 * 86_400_000)}&to=${at(to.getTime())}`,
    );
    expect(exact.status).toBe(200);
  });

  it('answers 500 for an actor type this build does not know', async () => {
    gateway.identity.audit.handlers.listAuditLogs = () =>
      Promise.resolve({
        entries: [auditLogEntryFixture({ actor: { type: 'ROBOT' } })],
        page: {},
      });
    const res = await call('get', `/admin/audit-logs?${window()}`);
    expect(res.status).toBe(500);
  });

  it('lists the action vocabulary as strings', async () => {
    const res = await call('get', '/admin/audit-logs/actions');
    expect(res.body).toEqual({ data: ['A_ACTION', 'B_ACTION'] });
  });
});
