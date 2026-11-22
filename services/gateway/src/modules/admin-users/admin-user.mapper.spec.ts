import {
  AccountKind,
  EmailDeliveryStatus,
  EmailTemplate,
  OwnerRegistrationStatus,
  OwnerStatus,
} from '@wayfare/contracts';
import {
  accountKindProto,
  emailDeliveryStatusProto,
  emailTemplateProto,
  ownerRegistrationStatusProto,
  ownerStatusProto,
} from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import {
  toAdminUserListItemResponse,
  toAdminUserResponseDto,
  toAdminUserViewResponse,
  toDeactivateUserRequest,
  toEmailDeliveryResponseDto,
  toListUsersRequest,
  toLockUserRequest,
} from './admin-user.mapper';

const at = new Date('2026-05-01T00:00:00.000Z');
const ts = toProtoTimestamp(at);
const user = (over: Partial<identityGrpc.AdminUser> = {}) =>
  ({
    id: 'u1',
    email: 'an@wayfare.test',
    roles: [],
    isLocked: false,
    ownerVerified: false,
    isEmailVerified: true,
    createdAt: ts,
    kind: accountKindProto.toProto(AccountKind.TOURIST),
    ...over,
  }) as identityGrpc.AdminUser;
const erased = { id: 'u9', erasedAt: ts };

describe('an account for the console', () => {
  it('reads absent name, dates and registration as null', () => {
    expect(toAdminUserResponseDto(user())).toMatchObject({
      erased: false,
      fullName: null,
      lockedUntil: null,
      lastLoginAt: null,
      deletedAt: null,
      kind: AccountKind.TOURIST,
      ownerRegistrationStatus: null,
    });
  });

  it('reads the name and the registration’s status when identity sends them', () => {
    expect(
      toAdminUserResponseDto(
        user({
          fullName: 'An',
          ownerRegistrationStatus: ownerRegistrationStatusProto.toProto(
            OwnerRegistrationStatus.PENDING,
          ),
        }),
      ),
    ).toMatchObject({ fullName: 'An', ownerRegistrationStatus: OwnerRegistrationStatus.PENDING });
  });

  it('refuses no user, and a kind this build doesn’t know', () => {
    expect(() => toAdminUserResponseDto(undefined)).toThrow('without its user');
    expect(() => toAdminUserResponseDto(user({ kind: 99 as never }))).toThrow(
      'identity sent an unknown kind: 99',
    );
  });

  it('lists an erased account as its placeholder, any other as itself', () => {
    expect(toAdminUserListItemResponse({ erased })).toEqual({
      erased: true,
      id: 'u9',
      erasedAt: at.toISOString(),
    });
    expect(toAdminUserListItemResponse({ user: user() })).toMatchObject({
      erased: false,
      id: 'u1',
    });
  });
});

describe('the detail view', () => {
  const detail = (over: Partial<identityGrpc.AdminUserDetail> = {}) =>
    ({
      user: user(),
      devicesCount: 2,
      permissionCodes: [],
      passwordSet: true,
      preferredLocale: 'en',
      ...over,
    }) as identityGrpc.AdminUserDetail;

  it('shows an erased account as its placeholder', () => {
    expect(toAdminUserViewResponse({ erased })).toEqual({
      erased: true,
      id: 'u9',
      erasedAt: at.toISOString(),
    });
  });

  it('counts sessions as zero where identity sends none; no registration, lock or Google', () => {
    expect(toAdminUserViewResponse({ user: detail() })).toMatchObject({
      billing: null,
      sessions: { live: 0, byClient: { CONSOLE: 0, WEB: 0, MOBILE: 0 } },
      lockReason: null,
      googleEmail: null,
      devicesLastSeenAt: null,
      ownerRegistration: null,
    });
  });

  it('reads the sessions and the registration, unreviewed or reviewed', () => {
    const registration = {
      status: ownerRegistrationStatusProto.toProto(OwnerRegistrationStatus.APPROVED),
      submittedAt: ts,
    };
    const view = (reviewedAt?: typeof ts) =>
      toAdminUserViewResponse({
        user: detail({
          sessions: { live: 3, console: 1, web: 1, mobile: 1 },
          ownerRegistration: { ...registration, reviewedAt },
        }),
      });
    expect(view()).toMatchObject({
      sessions: { live: 3, byClient: { CONSOLE: 1, WEB: 1, MOBILE: 1 } },
      ownerRegistration: { status: OwnerRegistrationStatus.APPROVED, reviewedAt: null },
    });
    expect(view(ts)).toMatchObject({ ownerRegistration: { reviewedAt: at.toISOString() } });
  });

  it('refuses an answer with neither the account nor its placeholder', () => {
    expect(() => toAdminUserViewResponse({})).toThrow('GetUser returned nothing');
  });
});

describe('the user writes', () => {
  it('lists with only the filters given, deleted accounts left out by default', () => {
    const page = { page: 1, pageSize: 20, sort: '-createdAt' };
    expect(toListUsersRequest(page as never)).toEqual({ page, includeDeleted: false });
    expect(
      toListUsersRequest({
        ...page,
        q: 'an',
        roleId: 'r1',
        isLocked: true,
        ownerStatus: OwnerStatus.VERIFIED,
        includeDeleted: true,
      } as never),
    ).toEqual({
      page: { ...page, q: 'an' },
      roleId: 'r1',
      isLocked: true,
      ownerStatus: ownerStatusProto.toProto(OwnerStatus.VERIFIED),
      includeDeleted: true,
    });
  });

  it('locks indefinitely without an expiry, until it with one', () => {
    expect(toLockUserRequest('u1', { reason: 'spam' }).lockedUntil).toBeUndefined();
    expect(
      toLockUserRequest('u1', { reason: 'spam', lockedUntil: at.toISOString() }).lockedUntil,
    ).toEqual(ts);
  });

  it('deactivates without refunding vouchers unless asked', () => {
    expect(toDeactivateUserRequest('u1', { reason: 'r' }).refundUnredeemedVouchers).toBe(false);
    expect(
      toDeactivateUserRequest('u1', { reason: 'r', refundUnredeemedVouchers: true })
        .refundUnredeemedVouchers,
    ).toBe(true);
  });
});

describe('an email delivery', () => {
  const delivery = {
    id: 'd1',
    template: emailTemplateProto.toProto(EmailTemplate.PASSWORD_RESET),
    status: emailDeliveryStatusProto.toProto(EmailDeliveryStatus.SENT),
    bounceType: 0,
    statusChangedAt: ts,
    createdAt: ts,
  } as identityGrpc.EmailDeliveryView;

  it('reads an unset bounce type and an absent address as null', () => {
    expect(toEmailDeliveryResponseDto(delivery)).toMatchObject({
      template: EmailTemplate.PASSWORD_RESET,
      status: EmailDeliveryStatus.SENT,
      toEmailMasked: null,
      bounceType: null,
    });
  });

  it('refuses a template or status this build doesn’t know', () => {
    expect(() => toEmailDeliveryResponseDto({ ...delivery, template: 99 as never })).toThrow(
      'unknown enum value',
    );
    expect(() => toEmailDeliveryResponseDto({ ...delivery, status: 99 as never })).toThrow(
      'unknown enum value',
    );
  });
});
