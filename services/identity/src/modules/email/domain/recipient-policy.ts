/** Where a mail may go: everywhere, or only to an allowlist with a catch-all (conventions §11.4). */
export type DeliveryPolicy =
  | { readonly mode: 'open' }
  | {
      readonly mode: 'restricted';
      /** Exact addresses, or `*@domain` entries; normalized. */
      readonly allowlist: readonly string[];
      readonly catchall: string;
    };

/** True when a normalized address matches an exact entry or a `*@domain` entry. */
export function isAllowlisted(address: string, allowlist: readonly string[]): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1);
  return allowlist.some((entry) => entry === address || entry === `*@${domain}`);
}

/**
 * The address a mail is actually delivered to. Restricted delivery sends everything outside the
 * allowlist to the catch-all; the delivery row still records the intended recipient.
 */
export function deliveryAddress(policy: DeliveryPolicy, address: string): string {
  if (policy.mode === 'open') return address;
  return isAllowlisted(address, policy.allowlist) ? address : policy.catchall;
}
