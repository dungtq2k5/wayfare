import { zTourDetail, zTourSummary } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** One tour of `GET /tours`. */
export class TourSummaryResponseDto extends createZodDto(zTourSummary) {}

/** What `GET /tours/:id` and `GET /tours/by-code/:publicCode` return under `data`. */
export class TourDetailResponseDto extends createZodDto(zTourDetail) {}
