import { Injectable } from '@nestjs/common';
import {
  AUDIT_RECORD,
  AuditAction,
  AuditActorType,
  AuditResourceType,
  MAX_LANGUAGE_CODE_LENGTH,
  MAX_POLICY_VERSION_LENGTH,
  MAX_VERSION_LENGTH,
  newId,
} from '@wayfare/contracts';
import type { identityGrpc } from '@wayfare/contracts/grpc';
import { generateToken, hashToken, OutboxService, rpcError } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { fromProtoPlatform, toRegisterDeviceResponse } from './device.mapper';

/** gRPC-edge validation of the string fields; the gateway validates the same bounds first. */
const registerDeviceFields = z.object({
  appVersion: z.string().min(1).max(MAX_VERSION_LENGTH),
  osVersion: z.string().min(1).max(MAX_VERSION_LENGTH).optional(),
  contentLocale: z.string().min(2).max(MAX_LANGUAGE_CODE_LENGTH),
  privacyPolicyVersion: z.string().min(1).max(MAX_POLICY_VERSION_LENGTH),
});

/** Device registration — rdm-spec I-2, api-endpoints-plan §1.1. */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Creates a device and returns its secret exactly once; only the secret's SHA-256 is stored.
   * The `DEVICE_REGISTERED` audit event is written to the outbox in the same transaction.
   *
   * `privacyPolicyVersion` is validated but not yet recorded: the I-12 acceptance table does not exist yet.
   */
  async registerDevice(
    request: identityGrpc.RegisterDeviceRequest,
    context: RequestContext,
  ): Promise<identityGrpc.RegisterDeviceResponse> {
    const fields = registerDeviceFields.safeParse(request);
    if (!fields.success) {
      throw rpcError('VALIDATION_FAILED', {
        issues: fields.error.issues.map((issue) => ({
          path: `/${issue.path.join('/')}`,
          code: issue.code,
        })),
      });
    }
    const platform = fromProtoPlatform(request.platform); // convert once, reuse below
    const deviceSecret = generateToken(); // returned once, never stored
    const deviceId = newId();

    await this.prisma.$transaction(async (tx) => {
      await tx.device.create({
        data: {
          id: deviceId,
          secretHash: hashToken(deviceSecret),
          platform,
          appVersion: fields.data.appVersion,
          osVersion: fields.data.osVersion ?? null,
          contentLocale: fields.data.contentLocale,
        },
        select: { id: true },
      });
      await this.outbox.add(tx, AUDIT_RECORD, {
        occurredAt: new Date().toISOString(),
        service: 'identity',
        actor: { type: AuditActorType.DEVICE, deviceId },
        action: AuditAction.DEVICE_REGISTERED,
        resource: { type: AuditResourceType.DEVICE, id: deviceId },
        metadata: { after: { platform, appVersion: fields.data.appVersion } }, // I-11 shape; allowlisted fields only
        ...(context.origin.ip === null ? {} : { ip: context.origin.ip }),
        ...(context.origin.userAgent === null ? {} : { userAgent: context.origin.userAgent }),
      }); // eventId is supplied by outbox.add
    });

    return toRegisterDeviceResponse(deviceId, deviceSecret);
  }
}
