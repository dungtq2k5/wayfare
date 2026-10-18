import { useRef, useState } from 'react';
import { useNetworkStore } from '../network/network-store';

/**
 * A form's submit (K4): one request at a time — a second tap while one runs does nothing (edge 1)
 * — and none offline, where the form keeps its fields under the offline note (frame A9).
 */
export function useSubmit() {
  const offline = useNetworkStore((state) => state.status === 'offline');
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const submit = async (run: () => Promise<void>): Promise<void> => {
    if (busy.current || offline) return;
    busy.current = true;
    setRunning(true);
    try {
      await run();
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };
  return { submit, running, offline };
}
