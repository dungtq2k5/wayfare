import { zUuidV7 } from '@wayfare/contracts';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** `POST /devices` response. `deviceSecret` is returned exactly once. */
export const registerDeviceResponseSchema = z.object({
  deviceId: zUuidV7,
  deviceSecret: z.string().min(1),
});

/** What `POST /devices` returns under `data`. */
export class RegisterDeviceResponseDto extends createZodDto(registerDeviceResponseSchema) {}
