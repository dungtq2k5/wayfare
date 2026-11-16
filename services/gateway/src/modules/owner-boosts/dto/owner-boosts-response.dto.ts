import { zOwnerBoosts } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** `GET /owner/boosts`: the slots, the live boosts, the recent ended ones. */
export class OwnerBoostsResponseDto extends createZodDto(zOwnerBoosts) {}
