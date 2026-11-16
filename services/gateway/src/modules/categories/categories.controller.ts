import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, Auth, Ctx, PublicCache, RateLimit, UsesUpstream } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { CategoriesService } from './categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';

/** `/categories` — a public read a CDN may hold (api-endpoints-plan §2.1). */
@ApiTags('categories')
@UsesUpstream()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @PublicCache(300)
  @ApiOperation({ summary: 'Active categories, in display order.' })
  @ApiEnvelope(CategoryResponseDto, { array: true })
  @ZodSerializerDto([CategoryResponseDto])
  list(@Ctx() context: RequestContext): Promise<CategoryResponseDto[]> {
    return this.categories.list(context);
  }
}
