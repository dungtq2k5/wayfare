import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, Auth, Ctx, PublicCache, RateLimit, UsesUpstream } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { AreasService } from './areas.service';
import { AreaResponseDto } from './dto/area-response.dto';

/** `/areas` — a public read a CDN may hold (api-endpoints-plan §2.1). */
@ApiTags('areas')
@UsesUpstream()
@Controller('areas')
export class AreasController {
  constructor(private readonly areas: AreasService) {}

  @Get()
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @PublicCache(300)
  @ApiOperation({ summary: 'Active pilot areas: boundary, map camera and dataset version.' })
  @ApiEnvelope(AreaResponseDto, { array: true })
  @ZodSerializerDto([AreaResponseDto])
  list(@Ctx() context: RequestContext): Promise<AreaResponseDto[]> {
    return this.areas.list(context);
  }
}
