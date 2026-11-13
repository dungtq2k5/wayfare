import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildOpenApiDocument } from '@wayfare/nest-common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openApiOptions } from '../../src/configure-app';
import { bootGateway } from '../support/app';
import type { E2eApp } from '../support/app';

/** The spec the API client is generated from, committed beside the client. */
const SPEC_PATH = resolve(__dirname, '../../../../packages/api-client/openapi.json');

let gateway: E2eApp;

beforeAll(async () => {
  gateway = await bootGateway();
});

afterAll(() => gateway.app.close());

describe('the committed OpenAPI spec', () => {
  // `pnpm api:generate` runs this with OPENAPI_WRITE=1; every other run compares.
  it('is the gateway’s document', () => {
    const document = buildOpenApiDocument(gateway.app, openApiOptions(gateway.config));
    const text = `${JSON.stringify(document, null, 2)}\n`;
    if (process.env.OPENAPI_WRITE === '1') {
      writeFileSync(SPEC_PATH, text);
      return;
    }
    expect(
      readFileSync(SPEC_PATH, 'utf8'),
      'packages/api-client/openapi.json is stale: run `pnpm api:generate` and commit the result',
    ).toBe(text);
  });
});
