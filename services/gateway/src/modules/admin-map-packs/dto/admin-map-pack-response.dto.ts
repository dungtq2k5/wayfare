import { zMapPack } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A map pack as the console lists it. */
export class MapPackResponseDto extends createZodDto(zMapPack) {}

/** `{ mapPack }`, as registration and publication return it. */
export const mapPackResultResponseSchema = z.object({ mapPack: zMapPack }).strict();

/** What registration and publication return under `data`. */
export class MapPackResultResponseDto extends createZodDto(mapPackResultResponseSchema) {}
