import { safeNext } from '../../../session/next';
import { SignInForm } from './sign-in-form';

/** Sign in (C1–C1c, C5). */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; signedOut?: string; reset?: string; recovered?: string }>;
}) {
  const { next, signedOut, reset, recovered } = await searchParams;
  const notice =
    signedOut === '1'
      ? 'signedOut'
      : reset === '1'
        ? 'reset'
        : recovered === '1'
          ? 'recovered'
          : null;
  return <SignInForm next={safeNext(next)} notice={notice} />;
}
