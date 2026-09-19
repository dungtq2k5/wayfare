import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminSubmissionsController } from './admin-submissions.controller';
import { AdminSubmissionsService } from './admin-submissions.service';

/** `/admin/submissions`, backed by `catalog.SubmissionReviewService`. */
@Module({
  imports: [CatalogModule],
  controllers: [AdminSubmissionsController],
  providers: [AdminSubmissionsService],
})
export class AdminSubmissionsModule {}
