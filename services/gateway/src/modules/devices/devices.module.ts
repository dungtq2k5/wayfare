import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

/** `/devices` routes, backed by `identity.DeviceService`. */
@Module({
  imports: [IdentityModule],
  controllers: [DevicesController],
  providers: [DevicesService],
})
export class DevicesModule {}
