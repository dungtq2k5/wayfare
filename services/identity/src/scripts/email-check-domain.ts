// pnpm --filter @wayfare/identity email:check-domain — a deploy step (conventions §11.4): fails
// when the sending domain has open or click tracking on. Reads RESEND_ADMIN_API_KEY (a
// full-access key, supplied only to this step) and RESEND_DOMAIN_ID; the service never does.
import 'dotenv/config';
import { readResendDomainTracking } from '../providers/email/resend.email-provider';

/** A domain's tracking settings. */
export interface DomainTracking {
  readonly openTracking: boolean;
  readonly clickTracking: boolean;
}

/** Reads the settings; the real one calls Resend, tests pass a stub. */
export type ReadDomainTracking = (adminApiKey: string, domainId: string) => Promise<DomainTracking>;

/**
 * The check: `0` when both settings are off, `1` when either is on, the call fails, or the
 * variables are missing. Prints the settings, never the key.
 */
export async function checkDomain(
  env: Readonly<Record<string, string | undefined>>,
  read: ReadDomainTracking,
  print: (line: string) => void,
): Promise<0 | 1> {
  const key = env.RESEND_ADMIN_API_KEY;
  const domainId = env.RESEND_DOMAIN_ID;
  if (!key || !domainId) {
    print('✗ RESEND_ADMIN_API_KEY and RESEND_DOMAIN_ID are required');
    return 1;
  }
  let tracking: DomainTracking;
  try {
    tracking = await read(key, domainId);
  } catch (error) {
    print(`✗ could not read the domain: ${error instanceof Error ? error.message : 'unknown'}`);
    return 1;
  }
  print(`open_tracking: ${tracking.openTracking}`);
  print(`click_tracking: ${tracking.clickTracking}`);
  if (tracking.openTracking || tracking.clickTracking) {
    print('✗ tracking must be off on the sending domain (conventions §11.4)');
    return 1;
  }
  print('✓ tracking is off');
  return 0;
}

if (require.main === module) {
  void checkDomain(process.env, readResendDomainTracking, (line) => console.log(line)).then(
    (code) => process.exit(code),
  );
}
