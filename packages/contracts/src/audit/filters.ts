import { z } from 'zod';
import { MAX_AUDIT_ACTION_LENGTH } from '../identity/limits';

/**
 * An audit action as a list filter (api-endpoints-plan §1.8): any upper-snake string, so an
 * action the vocabulary has since retired can still be looked up (conventions §6.3).
 */
export const zAuditActionFilter = z
  .string()
  .max(MAX_AUDIT_ACTION_LENGTH)
  .regex(/^[A-Z][A-Z0-9_]*$/);
