import { FakeCheckoutLoader } from './loader';

/** The fake Checkout's page: *Pay* or *Cancel* (K16). */
export default async function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  return <FakeCheckoutLoader sessionId={sessionId} />;
}
