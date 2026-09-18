import type { Metadata } from '@grpc/grpc-js';
import { Controller } from '@nestjs/common';
import { identityGrpc } from '@wayfare/contracts/grpc';
import { unpackCallerContext } from '@wayfare/nest-common';
import { NotificationsService } from './notifications.service';

/** `wayfare.identity.NotificationService` — unpack the caller, delegate once. */
@Controller()
@identityGrpc.NotificationServiceControllerMethods()
export class NotificationsGrpcController implements identityGrpc.NotificationServiceController {
  constructor(private readonly notifications: NotificationsService) {}

  listNotifications(
    request: identityGrpc.ListNotificationsRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.ListNotificationsResponse> {
    return this.notifications.listNotifications(request, unpackCallerContext(metadata));
  }

  getUnreadCount(
    request: identityGrpc.GetUnreadCountRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.GetUnreadCountResponse> {
    return this.notifications.getUnreadCount(request, unpackCallerContext(metadata));
  }

  markRead(
    request: identityGrpc.MarkReadRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.MarkReadResponse> {
    return this.notifications.markRead(request, unpackCallerContext(metadata));
  }

  markAllRead(
    request: identityGrpc.MarkAllReadRequest,
    metadata?: Metadata,
  ): Promise<identityGrpc.MarkAllReadResponse> {
    return this.notifications.markAllRead(request, unpackCallerContext(metadata));
  }
}
