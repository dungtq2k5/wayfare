import { Module } from '@nestjs/common';
import { NarrationClientModule } from '../narration-client/narration-client.module';
import { NarrationController } from './narration.controller';
import { NarrationService } from './narration.service';

/** The tourist narration routes. */
@Module({
  imports: [NarrationClientModule],
  controllers: [NarrationController],
  providers: [NarrationService],
})
export class NarrationModule {}
