import 'reflect-metadata';
import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

@Injectable()
class Dependency {
  readonly value = 42;
}

@Injectable()
class Dependent {
  constructor(readonly dependency: Dependency) {}
}

// Guards the DI trap (ADR 0058): if the transform stops emitting decorator metadata, or an injected
// class is ever imported with `import type`, Nest resolves `undefined` — this test fails first.
describe('decorator metadata', () => {
  it('emits constructor parameter types', () => {
    expect(Reflect.getMetadata('design:paramtypes', Dependent)).toEqual([Dependency]);
  });

  it('lets Nest inject a class by its type alone', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [Dependency, Dependent],
    }).compile();
    expect(moduleRef.get(Dependent).dependency.value).toBe(42);
  });
});
