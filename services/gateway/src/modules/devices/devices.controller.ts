import { Body, Controller, Delete, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelope,
  ApiErrors,
  AppVersionFromBody,
  Auth,
  Ctx,
  NoStore,
  RateLimit,
  UsesUpstream,
} from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { ZodSerializerDto } from 'nestjs-zod';
import { DevicesService } from './devices.service';
import {
  DeviceResponseDto,
  DeviceTokenResponseDto,
  LegalAcceptanceResponseDto,
  RegisterDeviceResponseDto,
} from './dto/device-response.dto';
import {
  ExchangeDeviceTokenDto,
  RecordLegalAcceptanceDto,
  RegisterDeviceDto,
  UpdateDeviceDto,
} from './dto/device.dto';

/** `/devices` (api-endpoints-plan §1.1). */
@ApiTags('devices')
@UsesUpstream()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @Auth('PUBLIC')
  @RateLimit('DEVICE_REGISTRATION')
  @AppVersionFromBody('appVersion')
  @NoStore()
  @ApiOperation({ summary: 'Register an install. The device secret is returned exactly once.' })
  @ApiEnvelope(RegisterDeviceResponseDto)
  @ApiErrors('LEGAL_VERSION_OUTDATED', 'APP_VERSION_UNSUPPORTED')
  @ZodSerializerDto(RegisterDeviceResponseDto)
  register(
    @Ctx() context: RequestContext,
    @Body() body: RegisterDeviceDto,
  ): Promise<RegisterDeviceResponseDto> {
    return this.devices.register(context, body);
  }

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @Auth('PUBLIC')
  @RateLimit('PUBLIC_READ')
  @NoStore()
  @ApiOperation({ summary: 'Exchange the device secret for a fresh device access token.' })
  @ApiEnvelope(DeviceTokenResponseDto)
  @ApiErrors('UNAUTHENTICATED', 'DEVICE_REVOKED')
  @ZodSerializerDto(DeviceTokenResponseDto)
  exchange(
    @Ctx() context: RequestContext,
    @Body() body: ExchangeDeviceTokenDto,
  ): Promise<DeviceTokenResponseDto> {
    return this.devices.exchange(context, body);
  }

  @Patch('me')
  @Auth('DEVICE')
  @ApiOperation({
    summary: 'Update this install. A push token held by another install moves here.',
  })
  @ApiEnvelope(DeviceResponseDto)
  @ApiErrors('DEVICE_REVOKED', 'INVALID_STATE')
  @ZodSerializerDto(DeviceResponseDto)
  update(
    @Ctx() context: RequestContext,
    @Body() body: UpdateDeviceDto,
  ): Promise<DeviceResponseDto> {
    return this.devices.update(context, body);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth('DEVICE')
  @ApiOperation({
    summary: 'Forget this install and revoke its sessions. The account is untouched.',
  })
  @ApiEnvelope(null)
  async forget(@Ctx() context: RequestContext): Promise<void> {
    await this.devices.forget(context);
  }

  @Post('me/legal-acceptances')
  @Auth('DEVICE')
  @ApiOperation({ summary: "Record this install's acceptance of a policy version." })
  @ApiEnvelope(LegalAcceptanceResponseDto)
  @ApiErrors('DEVICE_REVOKED', 'LEGAL_VERSION_OUTDATED')
  @ZodSerializerDto(LegalAcceptanceResponseDto)
  acceptPolicy(
    @Ctx() context: RequestContext,
    @Body() body: RecordLegalAcceptanceDto,
  ): Promise<LegalAcceptanceResponseDto> {
    return this.devices.recordAcceptance(context, body);
  }
}
