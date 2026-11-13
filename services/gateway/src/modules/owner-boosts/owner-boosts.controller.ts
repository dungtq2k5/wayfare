import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { OwnerBoosts } from '@wayfare/contracts';
import { ApiEnvelope, ApiErrors, Auth, Ctx, NoStore, UsesUpstream } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { OwnerBoostsResponseDto } from './dto/owner-boosts-response.dto';
import { SetOwnerBoostsDto } from './dto/owner-boosts.dto';
import { OwnerBoostsService } from './owner-boosts.service';

/**
 * `/owner/boosts` — discovery boosts (api-endpoints-plan §5.2): the slots come with the plan; the
 * owner picks which live Venues use them. Never narration (ADR 0007).
 */
@ApiTags('owner-boosts')
@UsesUpstream()
@Controller('owner/boosts')
export class OwnerBoostsController {
  constructor(private readonly boosts: OwnerBoostsService) {}

  @Get()
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({ summary: 'The slots, the live boosts, and those ended in the last 90 days.' })
  @ApiEnvelope(OwnerBoostsResponseDto)
  @ApiErrors('RESOURCE_NOT_FOUND')
  @ZodSerializerDto(OwnerBoostsResponseDto)
  read(@Ctx() context: AccountContext): Promise<OwnerBoosts> {
    return this.boosts.read(context);
  }

  @Put()
  @Auth('OWNER')
  @NoStore()
  @ApiOperation({
    summary:
      'The complete set of Venues to boost: each the caller’s live Venue, no more than the slots. Ends what it leaves out.',
  })
  @ApiEnvelope(OwnerBoostsResponseDto)
  @ApiErrors('BOOST_SLOTS_EXCEEDED', 'INVALID_STATE', 'RESOURCE_NOT_FOUND')
  @ZodSerializerDto(OwnerBoostsResponseDto)
  set(@Ctx() context: AccountContext, @Body() body: SetOwnerBoostsDto): Promise<OwnerBoosts> {
    return this.boosts.set(context, body);
  }
}
