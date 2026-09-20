import { zCorrection, zLocalizationOverview } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** The correction screen: each language's text beside the correction held for it. */
export class LocalizationOverviewResponseDto extends createZodDto(zLocalizationOverview) {}

/** `{ correction }`, as a correction returns it. */
export const correctionResultResponseSchema = z.object({ correction: zCorrection }).strict();

/** What `PUT …/:lang` returns under `data`. */
export class CorrectionResultResponseDto extends createZodDto(correctionResultResponseSchema) {}
