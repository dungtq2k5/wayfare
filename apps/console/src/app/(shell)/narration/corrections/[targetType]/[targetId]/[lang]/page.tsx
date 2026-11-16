import { notFound } from 'next/navigation';
import { CorrectionEditor } from '../../../../../../../operations/corrections';
import { withOverview } from '../../../../../../../operations/correction-route';

/** Correct a language (T3). */
export default async function CorrectionPage({
  params,
}: {
  params: Promise<{ targetType: string; targetId: string; lang: string }>;
}) {
  const { lang } = await params;
  return withOverview(params, (overview) => {
    if (lang === 'vi' || !overview.languages.some((row) => row.lang === lang)) notFound();
    return <CorrectionEditor initial={overview} lang={lang} />;
  });
}
