import { ApiError, adminRecoveriesGet } from '@wayfare/api-client';
import { RecoveryPage } from '../../../../operations/recoveries';
import { serverCall } from '../../../../server/api';
import { denial } from '../../../../server/guard';
import { NotFoundView } from '../../../../states/states';

/** A recovery's page (V3), read on the server. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const denied = await denial('/recoveries');
  if (denied !== null) return denied;
  const { id } = await params;
  try {
    const { data } = await serverCall((options) => adminRecoveriesGet(id, options));
    return <RecoveryPage initial={data.recovery} />;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED')) {
      return (
        <NotFoundView
          resource={{ name: 'resource.recovery', list: 'nav.recoveries', href: '/recoveries' }}
        />
      );
    }
    throw error;
  }
}
