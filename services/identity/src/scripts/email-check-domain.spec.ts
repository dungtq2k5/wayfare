import { describe, expect, it } from 'vitest';
import { checkDomain } from './email-check-domain';

const env = { RESEND_ADMIN_API_KEY: 're_admin_secret', RESEND_DOMAIN_ID: 'dom_1' };

async function run(
  read: Parameters<typeof checkDomain>[1],
  environment: Record<string, string | undefined> = env,
) {
  const lines: string[] = [];
  const code = await checkDomain(environment, read, (line) => lines.push(line));
  return { code, output: lines.join('\n') };
}

describe('email:check-domain', () => {
  it('passes when both settings are off', async () => {
    const { code, output } = await run(() =>
      Promise.resolve({ openTracking: false, clickTracking: false }),
    );
    expect(code).toBe(0);
    expect(output).not.toContain('re_admin_secret');
  });

  it.each([
    { openTracking: true, clickTracking: false },
    { openTracking: false, clickTracking: true },
  ])('fails when tracking is on: %o', async (tracking) => {
    expect((await run(() => Promise.resolve(tracking))).code).toBe(1);
  });

  it('fails when the call fails or the variables are missing', async () => {
    expect((await run(() => Promise.reject(new Error('restricted_api_key')))).code).toBe(1);
    const read = () => Promise.resolve({ openTracking: false, clickTracking: false });
    expect((await run(read, { RESEND_DOMAIN_ID: 'dom_1' })).code).toBe(1);
  });
});
