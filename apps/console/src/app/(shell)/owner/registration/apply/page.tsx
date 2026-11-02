import { ownerRegistrationList } from '@wayfare/api-client';
import type { OwnerRegistration } from '@wayfare/contracts';
import { RegistrationForm } from '../../../../../owner/registration-form';
import { serverCall } from '../../../../../server/api';

/** Apply (N4, N4b, N6b): applying again starts from the latest answers (K2). */
export default async function Page() {
  const { data } = await serverCall((options) => ownerRegistrationList(options));
  return <RegistrationForm latest={(data as OwnerRegistration[])[0] ?? null} />;
}
