import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Provides identity's `PrismaService` to every module. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
