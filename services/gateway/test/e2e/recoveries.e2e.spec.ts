// Account recovery's routes (api-endpoints-plan §1.10): two staff permissions on the admin side,
// and two public routes that answer a stranger exactly what they answer a bad token.
import { status } from '@grpc/grpc-js';
import { newId, RecoveryEvidenceCode } from '@wayfare/contracts';
import { identityGrpc, recoveryEvidenceCodeProto } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { accountToken, bootGateway, serviceError } from '../support/app';
import type { E2eApp } from '../support/app';

let gateway: E2eApp;
const server = () => gateway.app.getHttpServer();
const recoveryId = newId();
const ownerId = newId();
const at = toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z'));

/** A console request with the given permissions. */
function console_(method: 'get' | 'post', path: string, perms: string[]) {
  const agent = request(server());
  return agent[method](`/api/v1${path}`)
    .set('X-Wayfare-Client', 'console')
    .set('Cookie', `wf_at=${accountToken({ perms })}`);
}

/** Anyone at all: the owner's own routes take a token, not a session. */
const anyone = (path: string) =>
  request(server()).post(`/api/v1${path}`).set('X-Wayfare-Client', 'web');

const recovery = (over: Partial<identityGrpc.Recovery> = {}): identityGrpc.Recovery => ({
  id: recoveryId,
  userId: ownerId,
  status: identityGrpc.AccountRecoveryStatus.ACCOUNT_RECOVERY_STATUS_PENDING_APPROVAL,
  requestedEmail: 'new@example.com',
  evidenceCodes: [
    recoveryEvidenceCodeProto.toProto(RecoveryEvidenceCode.PHONE_CALLBACK),
    recoveryEvidenceCodeProto.toProto(RecoveryEvidenceCode.BILLING_KNOWLEDGE),
  ],
  supportReference: 'TICKET-1',
  openedById: newId(),
  holdUntil: undefined,
  completedAt: undefined,
  createdAt: at,
  updatedAt: at,
  expiresAt: at,
  ...over,
});

beforeAll(async () => {
  gateway = await bootGateway();
});
afterAll(() => gateway.app.close());
beforeEach(() => {
  gateway.identity.reset();
});

describe('/admin/email-recoveries', () => {
  it('opens a case with what support checked, and lists the queue', async () => {
    gateway.identity.adminRecoveries.handlers.openRecovery = () =>
      Promise.resolve({ recovery: recovery() });
    const opened = await console_('post', `/admin/users/${ownerId}/email-recoveries`, [
      'user.email.recover.open',
    ]).send({
      requestedEmail: 'new@example.com',
      evidenceCodes: ['PHONE_CALLBACK', 'BILLING_KNOWLEDGE'],
      supportReference: 'TICKET-1',
    });
    expect(opened.status).toBe(201);
    expect(opened.body.data.recovery).toMatchObject({
      id: recoveryId,
      status: 'PENDING_APPROVAL',
      requestedEmail: 'new@example.com',
      evidenceCodes: ['PHONE_CALLBACK', 'BILLING_KNOWLEDGE'],
      approvedById: null,
      holdUntil: null,
    });
    expect(gateway.identity.adminRecoveries.calls[0]!.request).toMatchObject({
      userId: ownerId,
      supportReference: 'TICKET-1',
    });

    gateway.identity.adminRecoveries.handlers.listRecoveries = () =>
      Promise.resolve({ recoveries: [recovery()], page: { page: 1, pageSize: 20, total: 1 } });
    const listed = await console_('get', '/admin/email-recoveries?status=PENDING_APPROVAL', [
      'user.email.recover.open',
    ]);
    expect(listed.status).toBe(200);
    expect(listed.body.data[0].id).toBe(recoveryId);
    expect(listed.body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
  });

  it('lists an empty queue', async () => {
    gateway.identity.adminRecoveries.handlers.listRecoveries = () =>
      Promise.resolve({ recoveries: [], page: { page: 1, pageSize: 20, total: 0 } });
    const res = await console_('get', '/admin/email-recoveries', ['user.email.recover.open']);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('maps thin evidence to 422 and the self-approval refusal to 403', async () => {
    gateway.identity.adminRecoveries.handlers.openRecovery = () =>
      Promise.reject(
        serviceError(status.INVALID_ARGUMENT, {
          'wf-error-code': 'RECOVERY_EVIDENCE_INSUFFICIENT',
          'wf-http-status': '422',
        }),
      );
    const thin = await console_('post', `/admin/users/${ownerId}/email-recoveries`, [
      'user.email.recover.open',
    ]).send({
      requestedEmail: 'new@example.com',
      evidenceCodes: ['PHONE_CALLBACK'],
      supportReference: 'TICKET-1',
    });
    expect(thin.status).toBe(422);
    expect(thin.body.error.code).toBe('RECOVERY_EVIDENCE_INSUFFICIENT');

    gateway.identity.adminRecoveries.handlers.approveRecovery = () =>
      Promise.reject(
        serviceError(status.PERMISSION_DENIED, {
          'wf-error-code': 'RECOVERY_SELF_APPROVAL',
          'wf-http-status': '403',
        }),
      );
    const mine = await console_('post', `/admin/email-recoveries/${recoveryId}/approve`, [
      'user.email.recover.approve',
    ]);
    expect(mine.status).toBe(403);
    expect(mine.body.error.code).toBe('RECOVERY_SELF_APPROVAL');
  });

  it('keeps opening and approving apart: each route wants its own permission', async () => {
    const opener = await console_('post', `/admin/email-recoveries/${recoveryId}/approve`, [
      'user.email.recover.open',
    ]);
    expect(opener.status).toBe(403);
    const approver = await console_('post', `/admin/users/${ownerId}/email-recoveries`, [
      'user.email.recover.approve',
    ]).send({
      requestedEmail: 'new@example.com',
      evidenceCodes: ['PHONE_CALLBACK', 'BILLING_KNOWLEDGE'],
      supportReference: 'TICKET-1',
    });
    expect(approver.status).toBe(403);
  });

  it('rejects with a note', async () => {
    gateway.identity.adminRecoveries.handlers.rejectRecovery = () =>
      Promise.resolve({
        recovery: recovery({
          status: identityGrpc.AccountRecoveryStatus.ACCOUNT_RECOVERY_STATUS_REJECTED,
          decisionNote: 'Could not verify the caller',
        }),
      });
    const res = await console_('post', `/admin/email-recoveries/${recoveryId}/reject`, [
      'user.email.recover.approve',
    ]).send({ decisionNote: 'Could not verify the caller' });
    expect(res.status).toBe(200);
    expect(res.body.data.recovery).toMatchObject({
      status: 'REJECTED',
      decisionNote: 'Could not verify the caller',
    });
  });
});

describe('/account-recoveries', () => {
  it('cancels with a token, and without one when the owner is signed in', async () => {
    gateway.identity.recoveries.handlers.cancelRecovery = () => Promise.resolve({});
    const withToken = await anyone(`/account-recoveries/${recoveryId}/cancel`).send({
      token: 'the-token',
    });
    expect(withToken.status).toBe(204);
    expect(gateway.identity.recoveries.calls[0]!.request).toEqual({
      recoveryId,
      token: 'the-token',
    });

    const signedIn = await request(server())
      .post(`/api/v1/account-recoveries/${recoveryId}/cancel`)
      .set('X-Wayfare-Client', 'console')
      .set('Cookie', `wf_at=${accountToken({ perms: [] })}`)
      .send({});
    expect(signedIn.status).toBe(204);
    expect(gateway.identity.recoveries.calls.at(-1)!.request).toEqual({ recoveryId });
  });

  it('completes with the token and a new password, and refuses a short one', async () => {
    gateway.identity.recoveries.handlers.completeRecovery = () => Promise.resolve({});
    const res = await anyone('/account-recoveries/complete').send({
      token: 'the-token',
      newPassword: 'a long enough password',
    });
    expect(res.status).toBe(204);
    expect(gateway.identity.recoveries.calls[0]!.request).toEqual({
      token: 'the-token',
      newPassword: 'a long enough password',
    });

    const short = await anyone('/account-recoveries/complete').send({
      token: 'the-token',
      newPassword: 'short',
    });
    expect(short.status).toBe(400);
  });

  it('answers a spent token with 410, carrying nothing about the case', async () => {
    gateway.identity.recoveries.handlers.completeRecovery = () =>
      Promise.reject(
        serviceError(status.NOT_FOUND, {
          'wf-error-code': 'TOKEN_EXPIRED',
          'wf-http-status': '410',
        }),
      );
    const res = await anyone('/account-recoveries/complete').send({
      token: 'spent',
      newPassword: 'a long enough password',
    });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    expect(res.body.error).not.toHaveProperty('details.recoveryId');
  });
});
