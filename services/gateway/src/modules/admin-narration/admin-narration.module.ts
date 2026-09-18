import { Module } from '@nestjs/common';
import { NarrationClientModule } from '../narration-client/narration-client.module';
import { AdminNarrationController } from './admin-narration.controller';
import { AdminNarrationService } from './admin-narration.service';

/** The synthesis job monitor's routes. */
@Module({
  imports: [NarrationClientModule],
  controllers: [AdminNarrationController],
  providers: [AdminNarrationService],
})
export class AdminNarrationModule {}
