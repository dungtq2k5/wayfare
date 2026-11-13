import { ApiError, adminOwnerRegistrationsGet } from '@wayfare/api-client';
import { RegistrationPage } from '../../../../content/registration-page';
import { denial } from '../../../../server/guard';
import { serverCall } from '../../../../server/api';
import { NotFoundView } from '../../../../states/states';

/** An application (R2–R4b), read on the server with the caller's session. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/registrations');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => adminOwnerRegistrationsGet(id, options));
    return <RegistrationPage initial={data} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView
          resource={{
            name: 'resource.registration',
            list: 'nav.registrations',
            href: '/registrations',
          }}
        />
      );
    }
    throw error;
  }
}
