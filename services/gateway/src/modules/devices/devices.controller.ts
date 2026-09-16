import { Body, Controller, Header, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors, Ctx } from '@wayfare/nest-common';
import type { RequestContext } from '@wayfare/nest-common';
import { ZodResponse } from 'nestjs-zod';
import { DevicesService } from './devices.service';
import { RegisterDeviceResponseDto } from './dto/device-response.dto';
import { RegisterDeviceDto } from './dto/device.dto';

/** `/devices` (api-endpoints-plan §1.1). */
@ApiTags('devices')
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  @ApiOperation({ summary: 'Register an install. The device secret is returned exactly once.' })
  @ZodResponse({
    status: HttpStatus.CREATED,
    type: RegisterDeviceResponseDto,
    description: 'Registered',
  })
  @ApiErrors(
    'CLIENT_HEADER_REQUIRED',
    'VALIDATION_FAILED',
    'MALFORMED_REQUEST',
    'UPSTREAM_UNAVAILABLE',
    'UPSTREAM_TIMEOUT',
  )
  @Header('Cache-Control', 'no-store')
  register(
    @Ctx() context: RequestContext,
    @Body() body: RegisterDeviceDto,
  ): Promise<RegisterDeviceResponseDto> {
    return this.devices.register(context, body);
  }
}
