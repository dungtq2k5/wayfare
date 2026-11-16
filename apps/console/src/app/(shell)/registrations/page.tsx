import { RegistrationsList } from '../../../content/registrations-list';
import { denial } from '../../../server/guard';

/** The registration queue (R1). */
export default async function RegistrationsPage() {
  return (await denial('/registrations')) ?? <RegistrationsList />;
}
