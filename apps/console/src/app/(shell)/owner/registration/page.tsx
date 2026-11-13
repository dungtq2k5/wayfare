import { ownerRegistrationList } from '@wayfare/api-client';
import type { OwnerRegistration } from '@wayfare/contracts';
import { RegistrationView } from '../../../../owner/registration';
import { serverCall } from '../../../../server/api';

/** *Your registration* (N2b, N5–N7), read on the server with the caller's session. */
export default async function Page() {
  const { data } = await serverCall((options) => ownerRegistrationList(options));
  return <RegistrationView initial={data as OwnerRegistration[]} />;
}
