import { AuditLog } from '../../../operations/audit-log';
import { denial } from '../../../server/guard';

/** The audit log (H1). */
export default async function AuditPage() {
  return (await denial('/audit')) ?? <AuditLog />;
}
