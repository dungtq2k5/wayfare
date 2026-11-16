import { Module } from '@nestjs/common';
import { PlacesModule } from '../places/places.module';
import { LocalizationsService } from './localizations.service';

/** The localization read model's writer (ADR 0040); its two consumers call it. */
@Module({
  imports: [PlacesModule],
  providers: [LocalizationsService],
  exports: [LocalizationsService],
})
export class LocalizationsModule {}
