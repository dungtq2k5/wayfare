import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Provides narration's `PrismaService` to every module. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
