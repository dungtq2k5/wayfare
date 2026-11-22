import { LegalDocument, LegalParty, Platform } from '@wayfare/contracts';
import { legalDocumentProto, legalPartyProto, platformProto } from '@wayfare/contracts/grpc';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { toProtoTimestamp } from '@wayfare/nest-common';
import { describe, expect, it } from 'vitest';
import {
  toDeviceResponseDto,
  toLegalAcceptanceResponseDto,
  toRegisterDeviceRequest,
  toUpdateDeviceRequest,
} from './device.mapper';

describe('the device writes', () => {
  it('registers with the OS version only when given', () => {
    const body = {
      platform: Platform.ANDROID,
      appVersion: '1.0.0',
      contentLocale: 'en',
      privacyPolicyVersion: '2026-01',
    };
    expect(toRegisterDeviceRequest(body as never)).toEqual({
      ...body,
      platform: platformProto.toProto(Platform.ANDROID),
    });
    expect(toRegisterDeviceRequest({ ...body, osVersion: '15' }).osVersion).toBe('15');
  });

  it('updates only what the body carries', () => {
    expect(toUpdateDeviceRequest({})).toEqual({});
    expect(
      toUpdateDeviceRequest({
        appVersion: '1.1.0',
        osVersion: '15',
        contentLocale: 'vi',
        pushToken: 'tok',
      }),
    ).toEqual({ appVersion: '1.1.0', osVersion: '15', contentLocale: 'vi', pushToken: 'tok' });
  });
});

describe('the device answers', () => {
  it('reads an absent OS version as null, and refuses no device', () => {
    expect(
      toDeviceResponseDto({ deviceId: 'd1', appVersion: '1.0.0', contentLocale: 'en' }),
    ).toEqual({ deviceId: 'd1', appVersion: '1.0.0', osVersion: null, contentLocale: 'en' });
    expect(() => toDeviceResponseDto(undefined)).toThrow('UpdateDevice answered without a device');
  });

  it('reads a legal acceptance, and refuses none or an enum this build doesn’t know', () => {
    const acceptance = {
      party: legalPartyProto.toProto(LegalParty.DEVICE),
      document: legalDocumentProto.toProto(LegalDocument.PRIVACY_POLICY),
      version: '2026-01',
      acceptedAt: toProtoTimestamp(new Date('2026-05-01T00:00:00.000Z')),
    } as identityGrpc.LegalAcceptance;
    expect(toLegalAcceptanceResponseDto(acceptance)).toMatchObject({
      party: LegalParty.DEVICE,
      document: LegalDocument.PRIVACY_POLICY,
    });
    expect(() => toLegalAcceptanceResponseDto(undefined)).toThrow('missing from the response');
    expect(() => toLegalAcceptanceResponseDto({ ...acceptance, document: 99 as never })).toThrow(
      'unknown enum value',
    );
  });
});
