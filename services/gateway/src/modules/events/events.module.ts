import { Module } from '@nestjs/common';
import { SOCKET_REVALIDATE_MS } from '@wayfare/contracts';
import { IdentityModule } from '../identity/identity.module';
import { NarrationClientModule } from '../narration-client/narration-client.module';
import { EventsGateway, SOCKET_REVALIDATE_INTERVAL } from './events.gateway';

/** The socket (api-endpoints-plan §9). */
@Module({
  imports: [IdentityModule, NarrationClientModule],
  providers: [
    { provide: SOCKET_REVALIDATE_INTERVAL, useValue: SOCKET_REVALIDATE_MS },
    EventsGateway,
  ],
})
export class EventsModule {}
