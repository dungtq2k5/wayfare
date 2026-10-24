import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { IdentityModule } from '../identity/identity.module';
import { AdminSubmissionsController } from './admin-submissions.controller';
import { AdminSubmissionsService } from './admin-submissions.service';

/** `/admin/submissions`, backed by `catalog.SubmissionReviewService`. */
@Module({
  imports: [CatalogModule, IdentityModule],
  controllers: [AdminSubmissionsController],
  providers: [AdminSubmissionsService],
})
export class AdminSubmissionsModule {}
