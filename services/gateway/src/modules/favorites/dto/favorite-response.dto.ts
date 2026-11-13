import { zFavorite } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** A saved Place, in the language asked. */
export class FavoriteResponseDto extends createZodDto(zFavorite) {}
