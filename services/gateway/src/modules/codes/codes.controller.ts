import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope, ApiErrors, Auth, Ctx, RateLimit, UsesUpstream } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { CodesService } from './codes.service';
import { CodeTargetResponseDto } from './dto/code-response.dto';
import { CodeParamDto } from './dto/code.dto';

/**
 * `/codes/:publicCode` — what a printed or typed code names, a Place or a tour (api-endpoints-plan
 * §2.1): the one resolver every reader of a code asks, the app's scanner and the web's `/p/` alike.
 */
@ApiTags('codes')
@UsesUpstream()
@Controller('codes')
export class CodesController {
  constructor(private readonly codes: CodesService) {}

  @Get(':publicCode')
  @Auth('PUBLIC')
  @RateLimit('LINK_READ')
  @ApiOperation({ summary: 'What a code names — a Place or a tour — live or not. Counts no scan.' })
  @ApiEnvelope(CodeTargetResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(CodeTargetResponseDto)
  resolve(
    @Ctx() context: RequestContext,
    @Param() params: CodeParamDto,
  ): Promise<CodeTargetResponseDto> {
    return this.codes.resolve(context, params.publicCode);
  }
}
