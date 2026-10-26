// The local stack, as the suite drives it outside the browser: the gateway's API with a cookie jar
// per actor, Mailpit's links, and the two resets between tests (rate limits, mail).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPO = resolve(__dirname, '../../../..');
/**
 * `E2E_STACK=screens`: the screen baselines' own stack (screens/stack.sh), every port up by 10000.
 * Otherwise the developer's stack, or CI's.
 */
export const SCREENS_STACK = process.env.E2E_STACK === 'screens';
export const CONSOLE = process.env.E2E_CONSOLE ?? `http://localhost:${SCREENS_STACK ? 5183 : 5173}`;
export const GATEWAY =
  process.env.E2E_GATEWAY ?? `http://localhost:${SCREENS_STACK ? 23000 : 13000}`;
export const API = `${GATEWAY}/api/v1`;
export const MAILPIT =
  process.env.E2E_MAILPIT ?? `http://localhost:${SCREENS_STACK ? 28025 : 8025}`;
/** The stack's containers are named `<prefix>-redis`, `<prefix>-identity-db`, … */
const CONTAINERS = SCREENS_STACK ? 'wayfare-screens' : 'wayfare';

/** A value of a service's local `.env`, never printed. */
export function envValue(service: string, key: string): string {
  const line = readFileSync(resolve(REPO, 'services', service, '.env'), 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith(`${key}=`));
  const value = line?.slice(key.length + 1).trim() ?? '';
  if (value === '') throw new Error(`set ${key} in services/${service}/.env`);
  return value;
}

/** One actor's session: the console's cookies, kept between calls. */
export class Actor {
  private readonly cookies = new Map<string, string>();

  async call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    expected = [200, 201, 202, 204],
    attempt = 0,
  ): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        'x-wayfare-client': 'console',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const [name = '', value = ''] = pair.split('=');
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    // On a loaded machine an upstream can be out of reach for a moment. A 503 means the gateway
    // reached no service, so nothing happened and any call is asked again; a 504 may have
    // happened, so only a read or a sign-in is.
    const retryable =
      response.status === 503 ||
      ([502, 504].includes(response.status) && (method === 'GET' || path === '/auth/login'));
    if (retryable && !expected.includes(response.status) && attempt < 5) {
      await new Promise((done) => setTimeout(done, 2_000 * (attempt + 1)));
      return this.call<T>(method, path, body, expected, attempt + 1);
    }
    if (!expected.includes(response.status))
      throw new Error(`${method} ${path} → ${response.status} ${text}`);
    return (text === '' ? undefined : JSON.parse(text)) as T;
  }

  signIn(email: string, password: string): Promise<unknown> {
    return this.call('POST', '/auth/login', { email, password });
  }
}

interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** The newest mail to `address` whose subject matches, waiting a few seconds for it to arrive. */
export async function mailTo(
  address: string,
  subject: RegExp,
): Promise<{ text: string; token: string; link: string }> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const { messages } = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=200`)).json()) as {
      messages: MailSummary[];
    };
    const found = messages.find(
      (mail) => mail.To.some((to) => to.Address === address) && subject.test(mail.Subject),
    );
    if (found !== undefined) {
      const { Text } = (await (await fetch(`${MAILPIT}/api/v1/message/${found.ID}`)).json()) as {
        Text: string;
      };
      const link = /https?:\/\/\S+#[^\s)>\]]+/u.exec(Text)?.[0] ?? '';
      const token = new URLSearchParams(link.split('#')[1] ?? '').get('token') ?? '';
      return { text: Text, token, link };
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`no mail to ${address} matching ${subject}`);
}

/** Every rate-limit counter gone, so one test's tries never spend another's budget. */
export function resetRateLimits(): void {
  execFileSync(
    'docker',
    [
      'exec',
      `${CONTAINERS}-redis`,
      'sh',
      '-c',
      "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del",
    ],
    {
      cwd: REPO,
      stdio: 'ignore',
    },
  );
}

/** Mailpit emptied. */
export async function clearMail(): Promise<void> {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
}

/** SQL against the local identity database, for the one row only identity reads (a bounce). */
export function identitySql(sql: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      `${CONTAINERS}-identity-db`,
      'psql',
      '-U',
      'wayfare',
      '-d',
      'wayfare_identity',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ],
    {
      cwd: REPO,
      encoding: 'utf8',
    },
  ).trim();
}
