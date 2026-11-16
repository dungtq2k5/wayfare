import { zCursorQuery, zRequestedLanguage, zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `/me/favorites/:placeId`. */
export const favoritePlaceParamSchema = z.object({ placeId: zUuidV7 }).strict();

/** Validated favourite path parameter. */
export class FavoritePlaceParamDto extends createZodDto(favoritePlaceParamSchema) {}

/** `GET /me/favorites` query (api-endpoints-plan §2.3): cursor style, in a language. */
export const favoritesQuerySchema = zCursorQuery.extend({ lang: zRequestedLanguage }).strict();

/** Validated favourites query. */
export class FavoritesQueryDto extends createZodDto(favoritesQuerySchema) {}
