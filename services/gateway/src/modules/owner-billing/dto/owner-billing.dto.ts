import { zCheckoutInput } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';

/** Validated `POST /owner/billing/checkout-session` body (api-endpoints-plan §5.1). */
export class CheckoutSessionDto extends createZodDto(zCheckoutInput) {}
