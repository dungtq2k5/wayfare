import { Module } from '@nestjs/common';
import { AreasModule } from '../areas/areas.module';
import { CategoriesModule } from '../categories/categories.module';
import { TaxonomyAdminGrpcController } from './taxonomy-admin-grpc.controller';
import { TaxonomyAdminService } from './taxonomy-admin.service';

/** The taxonomy's admin routes (api-endpoints-plan §3.6): categories and areas. */
@Module({
  imports: [CategoriesModule, AreasModule],
  controllers: [TaxonomyAdminGrpcController],
  providers: [TaxonomyAdminService],
})
export class TaxonomyAdminModule {}
