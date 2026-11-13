/**
 * Whether vouchers are sold (ADR 0066 defers the whole voucher chain). While false, plans keep
 * their voucher grant and commission, but owners are never told of it, staff see it as paused, and
 * a change touching only it raises or reduces nothing. Resuming the chain is this one line.
 */
export const VOUCHERS_AVAILABLE: boolean = false;
