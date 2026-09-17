import { Controller, Get, Module, Post } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { MessagePattern } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { OpsModule } from '../health/ops.module';
import { Auth, RequirePermission } from './auth.decorators';
import { STAFF_MEMBERSHIP_RESOLVER } from './auth.guard';
import { RouteContractCheck, RouteContractError } from './route-contract';

@Controller('ok')
class GoodController {
  @Get() @Auth('PUBLIC') list() {}
  @Post() @RequirePermission('place.update') update() {}
  @MessagePattern('not-http') handleMessage() {}
  helper() {}
}

@Controller('bad')
class BadController {
  @Get('none') unmarked() {}
  @Get('both') @Auth('USER') @RequirePermission('place.read') both() {}
  @Get('staff') @Auth('STAFF') staff() {}
}

@Auth('USER')
@Controller('inherited')
class ClassLevelController {
  @Get() read() {}
}

async function boot(controllers: (new () => unknown)[], providers: object[] = []) {
  @Module({
    imports: [DiscoveryModule],
    controllers,
    providers: [RouteContractCheck, ...(providers as never[])],
  })
  class TestModule {}
  const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  return app;
}

describe('route contract', () => {
  it('accepts routes with exactly one rule, class-level rules and non-HTTP handlers', async () => {
    const app = await boot([GoodController, ClassLevelController]);
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });

  it('refuses boot, naming each violation', async () => {
    const app = await boot([BadController]);
    const error = await app.init().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RouteContractError);
    expect((error as Error).message).toContain('BadController.unmarked has no @Auth');
    expect((error as Error).message).toContain('BadController.both has both');
    expect((error as Error).message).toContain(
      'BadController.staff uses STAFF, but no StaffMembershipResolver',
    );
  });

  it('accepts STAFF once a resolver is registered', async () => {
    @Controller('staff')
    class StaffOnly {
      @Get() @Auth('STAFF') redeem() {}
    }
    const app = await boot(
      [StaffOnly],
      [{ provide: STAFF_MEMBERSHIP_RESOLVER, useValue: { isActiveStaff: () => true } }],
    );
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });

  it('passes the shared ops routes', async () => {
    @Module({
      imports: [
        DiscoveryModule,
        OpsModule.forRoot({
          version: { service: 's', version: '0', gitSha: 'x', builtAt: 'y' },
          checks: { useFactory: () => [] },
        }),
      ],
      providers: [RouteContractCheck],
    })
    class WithOps {}
    const moduleRef = await Test.createTestingModule({ imports: [WithOps] }).compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await expect(app.init()).resolves.toBeDefined();
    await app.close();
  });
});
