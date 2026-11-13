import { Module } from '@nestjs/common';
import { AdminPlansController } from './admin-plans.controller';
import { AdminPlansService } from './admin-plans.service';

/** `/admin/plans`, backed by `billing.PlanAdminService`. */
@Module({ controllers: [AdminPlansController], providers: [AdminPlansService] })
export class AdminPlansModule {}
