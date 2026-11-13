import { zOwnerBoostsInput } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** Validated `PUT /owner/boosts` body: the complete set (api-endpoints-plan §5.2). */
export class SetOwnerBoostsDto extends createZodDto(zOwnerBoostsInput) {}
