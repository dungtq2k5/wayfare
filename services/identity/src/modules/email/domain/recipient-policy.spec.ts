import { describe, expect, it } from 'vitest';
import { deliveryAddress, isAllowlisted } from './recipient-policy';

const restricted = {
  mode: 'restricted',
  allowlist: ['*@example.com', 'ops@wayfare.app'],
  catchall: 'team@wayfare.local',
} as const;

describe('recipient policy', () => {
  it('open delivers to the address', () => {
    expect(deliveryAddress({ mode: 'open' }, 'real@owner.vn')).toBe('real@owner.vn');
  });

  it('restricted delivers to exact and domain entries, and redirects the rest', () => {
    expect(deliveryAddress(restricted, 'a@example.com')).toBe('a@example.com');
    expect(deliveryAddress(restricted, 'ops@wayfare.app')).toBe('ops@wayfare.app');
    expect(deliveryAddress(restricted, 'dev@wayfare.app')).toBe('team@wayfare.local');
    expect(deliveryAddress(restricted, 'real@owner.vn')).toBe('team@wayfare.local');
  });

  it('a domain entry never matches a subdomain or a lookalike', () => {
    expect(isAllowlisted('a@mail.example.com', ['*@example.com'])).toBe(false);
    expect(isAllowlisted('a@example.com.evil', ['*@example.com'])).toBe(false);
    expect(isAllowlisted('example.com@evil.vn', ['*@example.com'])).toBe(false);
  });
});
