import { zCodeTarget } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** What `GET /codes/:publicCode` returns under `data`. */
export class CodeTargetResponseDto extends createZodDto(zCodeTarget) {}
