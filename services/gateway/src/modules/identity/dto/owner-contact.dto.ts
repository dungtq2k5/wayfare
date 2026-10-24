import { z } from 'zod';

/**
 * A Venue owner's name and address, for a staff page that names them — a content moderator holds
 * no `user.read` (api-endpoints-plan §3.5). `null` for no owner, and for one identity cannot name
 * (erased, or identity unreachable).
 */
export const ownerContactSchema = z
  .object({ name: z.string().nullable(), email: z.string() })
  .nullable();
