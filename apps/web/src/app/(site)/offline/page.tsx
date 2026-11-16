import { NotSaved } from '../../../offline/not-saved';

/** The service worker's fallback for a page never opened here, while offline (WO2b). */
export default function OfflinePage() {
  return <NotSaved />;
}
