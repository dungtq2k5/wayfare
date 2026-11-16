import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /dev/google-token`: an ID token the fake issuer signed. */
export const fakeGoogleTokenResponseSchema = z.object({ idToken: z.string() });

/** What `POST /dev/google-token` returns under `data`. */
export class FakeGoogleTokenResponseDto extends createZodDto(fakeGoogleTokenResponseSchema) {}
