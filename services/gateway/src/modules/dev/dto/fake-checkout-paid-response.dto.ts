import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /dev/fake-stripe/checkout/:sessionId/pay`: where Stripe would send the owner back. */
export const fakeCheckoutPaidResponseSchema = z.object({ successUrl: z.string() });

/** What `POST /dev/fake-stripe/checkout/:sessionId/pay` returns under `data`. */
export class FakeCheckoutPaidResponseDto extends createZodDto(fakeCheckoutPaidResponseSchema) {}
