import { LocalizationTargetType, zCorrectionInput, zLanguage, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/admin/narration/localizations/:targetType/:targetId`. */
export const localizationTargetParamSchema = z
  .object({ targetType: z.enum(LocalizationTargetType), targetId: zUuidV7 })
  .strict();

/** Validated target path parameters. */
export class LocalizationTargetParamDto extends createZodDto(localizationTargetParamSchema) {}

/** `…/:lang` — never `vi`, which is the source (rdm-spec N-7). */
export const localizationLangParamSchema = localizationTargetParamSchema
  .extend({ lang: zLanguage })
  .strict();

/** Validated target and language path parameters. */
export class LocalizationLangParamDto extends createZodDto(localizationLangParamSchema) {}

/** Validated `PUT …/:lang` body (api-endpoints-plan §4.5). */
export class PutCorrectionDto extends createZodDto(zCorrectionInput) {}
