import { describe, expect, it } from 'vitest';
import { forwardedHeaders } from './forwarded';

const request = (headers: Record<string, string>) => (name: string) => headers[name] ?? null;

describe('the server helper (K3)', () => {
  it('passes the cookie and x-forwarded-for unchanged, adding nothing', () => {
    expect(
      forwardedHeaders(
        request({
          cookie: 'wf_at=a; wf_lang=vi',
          'x-forwarded-for': '203.0.113.7, 10.0.0.2',
          'x-real-ip': '10.0.0.9',
          host: 'console.example.com',
        }),
      ),
    ).toEqual({ cookie: 'wf_at=a; wf_lang=vi', 'x-forwarded-for': '203.0.113.7, 10.0.0.2' });
    expect(forwardedHeaders(request({}))).toEqual({});
  });

  it('never lets two simultaneous requests see each other’s cookie', async () => {
    const serve = async (cookie: string, delay: number) => {
      const read = request({ cookie });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return forwardedHeaders(read).cookie;
    };
    const [first, second] = await Promise.all([serve('wf_at=first', 20), serve('wf_at=second', 5)]);
    expect(first).toBe('wf_at=first');
    expect(second).toBe('wf_at=second');
  });
});
