import { Module } from '@nestjs/common';
import { SystemPlansService } from './system-plans.service';

/** `FREE`, as a system row (rdm-spec B-1). */
@Module({ providers: [SystemPlansService] })
export class SystemPlansModule {}
