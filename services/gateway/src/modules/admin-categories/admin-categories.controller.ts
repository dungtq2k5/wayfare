import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AdminCategory } from '@wayfare/contracts';
import {
  ApiEnvelope,
  ApiErrors,
  Ctx,
  NoStore,
  RequirePermission,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AdminCategoriesService } from './admin-categories.service';
import {
  AdminCategoryResponseDto,
  AdminCategoryResultResponseDto,
} from './dto/admin-category-response.dto';
import { CategoryIdParamDto, CreateCategoryDto, UpdateCategoryDto } from './dto/admin-category.dto';

/**
 * `/admin/categories` — the categories (api-endpoints-plan §3.6). The code never changes; changing
 * `appliesTo` or deactivating governs new choices only: Places that have a category keep it.
 */
@ApiTags('admin-categories')
@UsesUpstream()
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: AdminCategoriesService) {}

  @Get()
  @RequirePermission('catalog.taxonomy.manage')
  @NoStore()
  @ApiOperation({ summary: 'Every category, active or not, with how many Places use it.' })
  @ApiEnvelope(AdminCategoryResponseDto, { array: true })
  @ZodSerializerDto([AdminCategoryResponseDto])
  list(@Ctx() context: AccountContext): Promise<AdminCategory[]> {
    return this.categories.list(context);
  }

  @Post()
  @RequirePermission('catalog.taxonomy.manage')
  @NoStore()
  @ApiOperation({ summary: 'Create a category; a taken code is refused at `/code`.' })
  @ApiEnvelope(AdminCategoryResultResponseDto)
  @ZodSerializerDto(AdminCategoryResultResponseDto)
  create(
    @Ctx() context: AccountContext,
    @Body() body: CreateCategoryDto,
  ): Promise<{ category: AdminCategory }> {
    return this.categories.create(context, body);
  }

  @Patch(':id')
  @RequirePermission('catalog.taxonomy.manage')
  @NoStore()
  @ApiOperation({ summary: 'Change the icon, order or appliesTo, or deactivate; never the code.' })
  @ApiEnvelope(AdminCategoryResultResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(AdminCategoryResultResponseDto)
  update(
    @Ctx() context: AccountContext,
    @Param() params: CategoryIdParamDto,
    @Body() body: UpdateCategoryDto,
  ): Promise<{ category: AdminCategory }> {
    return this.categories.update(context, params.id, body);
  }
}
