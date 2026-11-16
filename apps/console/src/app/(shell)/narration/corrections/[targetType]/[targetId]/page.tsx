import { TargetLanguages } from '../../../../../../operations/corrections';
import { withOverview } from '../../../../../../operations/correction-route';

/** A target's languages (T2). */
export default async function TargetPage({
  params,
}: {
  params: Promise<{ targetType: string; targetId: string }>;
}) {
  return withOverview(params, (overview) => <TargetLanguages initial={overview} />);
}
