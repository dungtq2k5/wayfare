import { ApiError, adminLocalizationsOverview } from '@wayfare/api-client';
import type { LocalizationOverviewResponseDto } from '@wayfare/api-client';
import type { ReactElement } from 'react';
import { serverCall } from '../server/api';
import { denial } from '../server/guard';
import { NotFoundView } from '../states/states';
import type { TargetType } from './corrections';

const TARGETS: readonly string[] = ['PLACE', 'MENU_ITEM', 'TOUR', 'VOUCHER_OFFER', 'UI_BUNDLE'];

/**
 * A target's languages read on the server with the caller's session, handed to `render`; C14
 * without `localization.edit`, the not-found page for a target that isn't there.
 */
export async function withOverview(
  params: Promise<{ targetType: string; targetId: string }>,
  render: (overview: LocalizationOverviewResponseDto) => ReactElement,
): Promise<ReactElement> {
  const denied = await denial('/narration/corrections');
  if (denied !== null) return denied;
  const { targetType, targetId } = await params;
  const notFound = (
    <NotFoundView
      resource={{
        name: 'resource.target',
        list: 'nav.corrections',
        href: '/narration/corrections',
      }}
    />
  );
  if (!TARGETS.includes(targetType)) return notFound;
  try {
    const { data } = await serverCall((options) =>
      adminLocalizationsOverview(targetType as TargetType, targetId, options),
    );
    return render(data);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.code === 'VALIDATION_FAILED'))
      return notFound;
    throw error;
  }
}
