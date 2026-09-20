import { MAX_LANGUAGE_CODE_LENGTH, UiBundleNamespace } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/i18n/bundles/:namespace/:locale` (api-endpoints-plan §4.2). */
export const bundleParamSchema = z
  .object({
    namespace: z.enum(UiBundleNamespace),
    locale: z.string().min(2).max(MAX_LANGUAGE_CODE_LENGTH),
  })
  .strict();

/** Validated bundle path parameters. */
export class BundleParamDto extends createZodDto(bundleParamSchema) {}

/** `?sourceHash=` — a hint only: the server always answers with its current version. */
export const bundleQuerySchema = z.object({ sourceHash: z.string().max(64).optional() }).strict();

/** Validated bundle query. */
export class BundleQueryDto extends createZodDto(bundleQuerySchema) {}
