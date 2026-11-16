// pnpm --filter @wayfare/narration seed:dev — a starter pronunciation dictionary for a local stack
// (rdm-spec N-5). These are samples, not an editorial decision: an English voice reading Vietnamese
// proper nouns is the thing the dictionary exists to fix, and seeding a dozen of them makes the
// effect audible in the walk and the demo. A deployed environment has none of this — the dictionary
// is staff's to write. Run it through turbo, after identity's seed (it belongs to the seed editor)
// and before catalog's, so the Places it seeds are voiced with these entries already in place.
// Never in production; reconciled by term, like every other seed row; never deletes.
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { ReplacementType } from '@wayfare/contracts';
import { SEED_EDITOR_USER_ID } from '@wayfare/contracts/testing';
import { PrismaClient } from '../../generated/prisma/client';

/** Refuses a production environment: the dictionary there is staff's (ADR 0002). */
export function assertNotProduction(env: Readonly<Record<string, string | undefined>>): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('seed:dev refuses to run with NODE_ENV=production (ADR 0002)');
  }
}

/** The note every seeded entry carries, so staff can tell them from their own. */
const SAMPLE_NOTE = 'Sample from the development seed; edit or delete it freely.';

/**
 * Pilot proper nouns, as an English voice should read them (D8: `en` only — a Latin alias read by
 * a Japanese voice is worse than the original). Each is a `SUB` alias, which needs no phonetic
 * alphabet and so stays readable to a non-linguist editor.
 */
export const PILOT_DICTIONARY = [
  { term: 'Bến Thành', replacement: 'ben tahn' },
  { term: 'Nguyễn Huệ', replacement: 'ngwen hway' },
  { term: 'Đồng Khởi', replacement: 'dong kuh-ee' },
  { term: 'Sài Gòn', replacement: 'sai gon' },
  { term: 'Vĩnh Khánh', replacement: 'ving kahn' },
  { term: 'Bitexco', replacement: 'bee-tex-co' },
  { term: 'Chợ Lớn', replacement: 'cher lurn' },
  { term: 'Thủ Đức', replacement: 'too duck' },
  { term: 'bánh mì', replacement: 'bahn mee' },
  { term: 'phở', replacement: 'fuh' },
  { term: 'bún chả', replacement: 'boon cha' },
  { term: 'cà phê sữa đá', replacement: 'ca fe sua da' },
] as const;

/** Inserts the entries that are missing and leaves every existing one as the editor left it. */
export async function seedPilotDictionary(prisma: PrismaClient): Promise<string[]> {
  const lines: string[] = [];
  for (const sample of PILOT_DICTIONARY) {
    const existing = await prisma.pronunciationEntry.findFirst({
      where: { term: sample.term, targetLang: 'en' },
      select: { id: true },
    });
    if (existing !== null) {
      lines.push(`unchanged ${sample.term}`);
      continue;
    }
    await prisma.pronunciationEntry.create({
      data: {
        term: sample.term,
        targetLang: 'en',
        replacementType: ReplacementType.SUB,
        replacement: sample.replacement,
        note: SAMPLE_NOTE,
        createdById: SEED_EDITOR_USER_ID,
        updatedById: SEED_EDITOR_USER_ID,
      },
      select: { id: true },
    });
    lines.push(`created ${sample.term}`);
  }
  return lines;
}

async function main(): Promise<void> {
  assertNotProduction(process.env);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('No database URL — copy .env.example to .env');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const lines = await seedPilotDictionary(prisma);
    const created = lines.filter((line) => line.startsWith('created')).length;
    console.log(
      `✓ narration seed:dev — ${created} of ${PILOT_DICTIONARY.length} entries created, the rest unchanged`,
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
