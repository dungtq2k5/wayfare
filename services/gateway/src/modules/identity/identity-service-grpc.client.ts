import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { GrpcServiceCaller } from '@wayfare/nest-common';

/** Injection token for identity's gRPC connection. */
export const IDENTITY_GRPC = Symbol('IDENTITY_GRPC');

/**
 * identity as the gateway calls it: one caller per stub (conventions §6.2). Returns proto types only;
 * the deadline, caller metadata and down-versus-slow mapping live in each caller.
 */
@Injectable()
export class IdentityServiceGrpcClient implements OnModuleInit {
  readonly devices: GrpcServiceCaller<identityGrpc.DeviceServiceClient>;
  readonly auth: GrpcServiceCaller<identityGrpc.AuthServiceClient>;
  readonly users: GrpcServiceCaller<identityGrpc.UserServiceClient>;
  readonly adminUsers: GrpcServiceCaller<identityGrpc.AdminUserServiceClient>;
  readonly roles: GrpcServiceCaller<identityGrpc.RoleServiceClient>;
  readonly audit: GrpcServiceCaller<identityGrpc.AuditServiceClient>;
  readonly passwords: GrpcServiceCaller<identityGrpc.PasswordServiceClient>;
  readonly emailChange: GrpcServiceCaller<identityGrpc.EmailChangeServiceClient>;
  readonly emailWebhooks: GrpcServiceCaller<identityGrpc.EmailWebhookServiceClient>;
  readonly notifications: GrpcServiceCaller<identityGrpc.NotificationServiceClient>;
  readonly owner: GrpcServiceCaller<identityGrpc.OwnerServiceClient>;
  readonly ownerReview: GrpcServiceCaller<identityGrpc.OwnerReviewServiceClient>;
  readonly adminRecoveries: GrpcServiceCaller<identityGrpc.RecoveryAdminServiceClient>;
  readonly recoveries: GrpcServiceCaller<identityGrpc.RecoveryServiceClient>;

  constructor(@Inject(IDENTITY_GRPC) grpc: ClientGrpc) {
    this.devices = new GrpcServiceCaller(grpc, identityGrpc.DEVICE_SERVICE_NAME);
    this.auth = new GrpcServiceCaller(grpc, identityGrpc.AUTH_SERVICE_NAME);
    this.users = new GrpcServiceCaller(grpc, identityGrpc.USER_SERVICE_NAME);
    this.adminUsers = new GrpcServiceCaller(grpc, identityGrpc.ADMIN_USER_SERVICE_NAME);
    this.roles = new GrpcServiceCaller(grpc, identityGrpc.ROLE_SERVICE_NAME);
    this.audit = new GrpcServiceCaller(grpc, identityGrpc.AUDIT_SERVICE_NAME);
    this.passwords = new GrpcServiceCaller(grpc, identityGrpc.PASSWORD_SERVICE_NAME);
    this.emailChange = new GrpcServiceCaller(grpc, identityGrpc.EMAIL_CHANGE_SERVICE_NAME);
    this.emailWebhooks = new GrpcServiceCaller(grpc, identityGrpc.EMAIL_WEBHOOK_SERVICE_NAME);
    this.notifications = new GrpcServiceCaller(grpc, identityGrpc.NOTIFICATION_SERVICE_NAME);
    this.owner = new GrpcServiceCaller(grpc, identityGrpc.OWNER_SERVICE_NAME);
    this.adminRecoveries = new GrpcServiceCaller(grpc, identityGrpc.RECOVERY_ADMIN_SERVICE_NAME);
    this.recoveries = new GrpcServiceCaller(grpc, identityGrpc.RECOVERY_SERVICE_NAME);
    this.ownerReview = new GrpcServiceCaller(grpc, identityGrpc.OWNER_REVIEW_SERVICE_NAME);
  }

  onModuleInit(): void {
    this.devices.init();
    this.auth.init();
    this.users.init();
    this.adminUsers.init();
    this.roles.init();
    this.audit.init();
    this.passwords.init();
    this.emailChange.init();
    this.emailWebhooks.init();
    this.notifications.init();
    this.owner.init();
    this.ownerReview.init();
    this.adminRecoveries.init();
    this.recoveries.init();
  }
}
