import { Module } from '@nestjs/common';
import { OwnerEntitlementsService } from './owner-entitlements.service';

/** The owner entitlement projection (rdm-spec C-18). */
@Module({ providers: [OwnerEntitlementsService], exports: [OwnerEntitlementsService] })
export class OwnerEntitlementsModule {}
