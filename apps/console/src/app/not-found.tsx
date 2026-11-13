import { Wordmark } from '@wayfare/ui/wordmark';
import { NotFoundView } from '../states/states';

/** An unknown address (C15). */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-12">
      <Wordmark height={32} />
      <NotFoundView />
    </main>
  );
}
