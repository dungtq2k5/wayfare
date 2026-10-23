'use client';

import { PageHeader } from '@wayfare/ui/list';
import type { StatusTone } from '@wayfare/ui/surfaces';
import { useCallback, useState } from 'react';
import { useConsole } from '../i18n/provider';
import { DetailDemo } from './detail-demo';
import { FormDemo } from './form-demo';
import { CursorDemo, ListDemo } from './list-demo';
import { SAMPLE_PLACES } from './sample';
import type { SamplePlace } from './sample';

/** `/dev/patterns` (K16): every page pattern with sample Places, for Playwright and the designer. */
export default function PatternsDemo() {
  const { t } = useConsole();
  // The first Place's status is shared by P1's row and P2's actions, so P5's *Undo* shows in both.
  const [firstStatus, setFirstStatus] = useState<StatusTone>(SAMPLE_PLACES[0]!.status);
  const statusOf = useCallback(
    (place: SamplePlace) => (place.id === SAMPLE_PLACES[0]!.id ? firstStatus : place.status),
    [firstStatus],
  );
  return (
    <div className="flex flex-col gap-16">
      <PageHeader title={t('patterns.title')} description={t('patterns.lead')} />
      <ListDemo statusOf={statusOf} />
      <CursorDemo />
      <DetailDemo status={firstStatus} onStatus={setFirstStatus} />
      <FormDemo />
    </div>
  );
}
