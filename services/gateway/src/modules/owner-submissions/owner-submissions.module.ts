import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { OwnerSubmissionsController } from './owner-submissions.controller';
import { OwnerSubmissionsService } from './owner-submissions.service';

/** `/owner/submissions`, backed by `catalog.SubmissionService`. */
@Module({
  imports: [CatalogModule],
  controllers: [OwnerSubmissionsController],
  providers: [OwnerSubmissionsService],
})
export class OwnerSubmissionsModule {}
