import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';

/** The categories' administration (rdm-spec C-2, api-endpoints-plan §3.6). */
@Module({
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
