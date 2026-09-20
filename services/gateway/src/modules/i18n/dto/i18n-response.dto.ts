import { zUiBundleResponse } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** One UI string bundle (api-endpoints-plan §4.2). */
export class UiBundleResponseDto extends createZodDto(zUiBundleResponse) {}
