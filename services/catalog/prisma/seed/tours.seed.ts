// pnpm seed:dev — the pilot's tours, made as staff make one (`createTour`, activation requested):
// *District 1 landmarks*, six of the Places the simulated walk passes, in the walk's order (the
// seventh it passes, Khách sạn Continental, stays off the route), and *Vĩnh Khánh after dark*, three
// of the Vĩnh Khánh Venues. Their English comes from narration's translator; each goes live by
// itself once it arrives. Each keeps a fixed code. Run after both pilots; idempotent; never in
// production.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { UploadPurpose } from '@wayfare/contracts';
import { packageRoot } from '@wayfare/nest-common';
import type { AccountContext } from '@wayfare/nest-common';
import { config } from 'dotenv';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import { bumpTourSyncVersion, withSyncWrite } from '../../src/modules/sync/sync.service';
import { ToursService } from '../../src/modules/tours/tours.service';
import { UploadsService } from '../../src/modules/uploads/uploads.service';
import { assertNotProduction, SEED_EDITOR_CONTEXT } from './pilot-d1.seed';

const SEED_DIR = resolve(packageRoot(__dirname), 'prisma/seed');

/** One seeded tour: its fixed code, text, stops by their Places' codes, and a cover photo. */
interface SeedTour {
  readonly publicCode: string;
  readonly areaCode: string;
  readonly titleVi: string;
  readonly descriptionVi: string;
  readonly estimatedMinutes: number;
  readonly stops: readonly string[];
  readonly cover: string;
}

export const SEED_TOURS: readonly SeedTour[] = [
  {
    publicCode: 'T4QX8MRK',
    areaCode: 'hcmc-d1-core',
    titleVi: 'Danh thắng Quận 1',
    descriptionVi:
      'Một vòng đi bộ qua những công trình làm nên trung tâm Sài Gòn: từ chợ Bến Thành, dọc phố đi bộ Nguyễn Huệ đến Nhà hát Thành phố, Nhà thờ Đức Bà, Bưu điện Trung tâm và Dinh Độc Lập. Mỗi điểm dừng tự kể câu chuyện của mình khi bạn đến.',
    estimatedMinutes: 110,
    // Chợ Bến Thành, Phố đi bộ Nguyễn Huệ, Nhà hát Thành phố, Nhà thờ Đức Bà, Bưu điện, Dinh Độc Lập.
    stops: ['QK4V1TCX', 'NQ22ZQXK', 'GP7R4MY3', 'SCT7J6K3', 'EHFZVTBV', 'FKYRQVBJ'],
    cover: 'pilot-d1/photos/nha-hat-thanh-pho/1.jpg',
  },
  {
    publicCode: 'V8KH4N2D',
    areaCode: 'hcmc-d4-vinh-khanh',
    titleVi: 'Vĩnh Khánh về đêm',
    descriptionVi:
      'Phố ẩm thực Vĩnh Khánh lúc lên đèn: ốc, lẩu và bia vỉa hè, mỗi quán một câu chuyện. Dữ liệu mẫu.',
    estimatedMinutes: 60,
    // Quán Ốc Mẫu A, Quán Lẩu Mẫu B, Quán Bia Mẫu F.
    stops: ['Z63TCMMT', 'J1S5TAEA', 'FE5XX80A'],
    cover: 'pilot-d1/photos/nha-tho-duc-ba/1.jpg',
  },
];

/** Creates each tour once, then gives it its fixed code; a tour already holding it is skipped. */
export async function seedTours(
  deps: { prisma: PrismaService; tours: ToursService; uploads: UploadsService },
  tours: readonly SeedTour[],
  context: AccountContext,
): Promise<string[]> {
  const lines: string[] = [];
  for (const seed of tours) {
    if ((await deps.prisma.tour.count({ where: { publicCode: seed.publicCode } })) > 0) {
      lines.push(`✓ kept ${seed.publicCode} ${seed.titleVi}`);
      continue;
    }
    const area = await deps.prisma.area.findUniqueOrThrow({
      where: { code: seed.areaCode },
      select: { id: true },
    });
    const places = await deps.prisma.place.findMany({
      where: { publicCode: { in: [...seed.stops] } },
      select: { id: true, publicCode: true },
    });
    const byCode = new Map(places.map((place) => [place.publicCode, place.id]));
    const placeIds = seed.stops.map((code) => {
      const id = byCode.get(code);
      if (id === undefined) throw new Error(`seed tour ${seed.publicCode}: no Place ${code}`);
      return id;
    });
    const { uploadId } = await deps.uploads.importOriginal(
      context,
      { bytes: readFileSync(resolve(SEED_DIR, seed.cover)), contentType: 'image/jpeg' },
      UploadPurpose.TOUR_COVER,
    );
    const { tour } = await deps.tours.createTour(
      {
        titleVi: seed.titleVi,
        descriptionVi: seed.descriptionVi,
        areaId: area.id,
        estimatedMinutes: seed.estimatedMinutes,
        coverUploadId: uploadId,
        placeIds,
        requestActivation: true,
      },
      context,
    );
    // The fixed code the frames and the tests read: the tour's row and its code-space row together.
    await withSyncWrite(deps.prisma, async (tx) => {
      await tx.publicCode.update({
        where: { code: tour!.publicCode },
        data: { code: seed.publicCode },
      });
      await tx.tour.update({ where: { id: tour!.id }, data: { publicCode: seed.publicCode } });
      await bumpTourSyncVersion(tx, tour!.id);
    });
    lines.push(`✓ created ${seed.publicCode} ${seed.titleVi}`);
  }
  return lines;
}

async function main(): Promise<void> {
  assertNotProduction(process.env);
  config({ path: resolve(packageRoot(__dirname), '.env'), quiet: true });
  if (process.env.PRISMA_DB === 'test') process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
  const app = await NestFactory.createApplicationContext(AppModule.forRoot({ jobs: false }), {
    logger: ['error', 'warn'],
  });
  try {
    const lines = await seedTours(
      {
        prisma: app.get(PrismaService),
        tours: app.get(ToursService),
        uploads: app.get(UploadsService),
      },
      SEED_TOURS,
      SEED_EDITOR_CONTEXT,
    );
    for (const line of lines) console.log(line);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
