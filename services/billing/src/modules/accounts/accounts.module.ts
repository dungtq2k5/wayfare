import { Module } from '@nestjs/common';
import { AccountsGrpcController } from './accounts-grpc.controller';
import { AccountsService } from './accounts.service';

/** Billing accounts, for staff (api-endpoints-plan §6.2). */
@Module({ controllers: [AccountsGrpcController], providers: [AccountsService] })
export class AccountsModule {}
