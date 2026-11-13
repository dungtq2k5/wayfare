// pnpm --filter @wayfare/narration db:seed:system — writes the committed UI bundles into the
// database `PRISMA_DB` selects (working or test), as narration's boot expects them. Part of
// `pnpm db:deploy` in every environment, so the apps' strings exist before the first request, like
// the category registry. Only a locale whose translation is committed is written, and it is
// written as `STATIC`: a row claiming Japanese while holding English would never be corrected,
// where a machine row is (rdm-spec N-6).
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  UI_BUNDLE_KEEP_VERSIONS,
  UiBundleOrigin,
  UiBundleStatus,
  LONG_TAIL_LANGUAGES,
  CONTENT_LANGUAGES,
} from '@wayfare/contracts';
import { BUNDLE_LOCALES, bundleSourceHash, readUiBundle, UI_NAMESPACES } from '@wayfare/i18n';
import { PrismaClient } from '../../generated/prisma/client';

/** The languages an app may ask for that nobody has committed a translation of yet. */
function uncommitted(): string[] {
  return [...CONTENT_LANGUAGES, ...LONG_TAIL_LANGUAGES].filter(
    (lang) => !(BUNDLE_LOCALES as readonly string[]).includes(lang),
  );
}

/** Writes the committed bundles and prunes to the newest versions; returns one line per write. */
export async function seedSystemBundles(prisma: PrismaClient): Promise<string[]> {
  const lines: string[] = [];
  for (const namespace of UI_NAMESPACES) {
    const sourceHash = bundleSourceHash(namespace);
    for (const locale of BUNDLE_LOCALES) {
      const messages = readUiBundle(locale, namespace);
      const existing = await prisma.uiBundle.findUnique({
        where: { namespace_locale_sourceHash: { namespace, locale, sourceHash } },
        select: { id: true },
      });
      if (existing === null) {
        await prisma.uiBundle.create({
          data: {
            namespace,
            locale,
            sourceHash,
            status: UiBundleStatus.READY,
            origin: UiBundleOrigin.STATIC,
            messages,
            failedKeys: [],
          },
          select: { id: true },
        });
        lines.push(`created ${namespace}/${locale}`);
      } else {
        // The committed strings are the truth for this version; a row for it is never rewritten.
        lines.push(`unchanged ${namespace}/${locale}`);
      }
      const kept = await prisma.uiBundle.findMany({
        where: { namespace, locale },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
        take: UI_BUNDLE_KEEP_VERSIONS,
      });
      await prisma.uiBundle.deleteMany({
        where: { namespace, locale, id: { notIn: kept.map((row) => row.id) } },
      });
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const url =
    process.env.PRISMA_DB === 'test' ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
  if (!url) throw new Error('No database URL — copy .env.example to .env');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const lines = await seedSystemBundles(prisma);
    const created = lines.filter((line) => line.startsWith('created')).length;
    console.log(
      `✓ ui bundles: ${created} written, ${lines.length - created} unchanged ` +
        `(${process.env.PRISMA_DB ?? 'working'})`,
    );
    // Said plainly, because it is the difference between a translated app and an English one.
    console.log(
      `  committed locales: ${BUNDLE_LOCALES.join(', ')}; machine-translated on first request: ` +
        `${uncommitted().join(', ')}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
