'use client';

import { SOCKET_EVENTS } from '@wayfare/contracts';
import type { SocketEventKey, SocketPayload } from '@wayfare/contracts';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { session } from '../client/browser-api';
import { API_ORIGIN } from '../env';

const SocketContext = createContext<Socket | null>(null);

/**
 * The shell's one socket (api-endpoints-plan §9): `/ws`, WebSocket only, the access cookie,
 * `auth.client: "console"`. A refusal for the session refreshes once, by K4's rule, and connects
 * again; the server joins it to its rooms (the person's own, `admin:narration` with
 * `narration.job.read`).
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  useEffect(() => {
    const next = io(`${API_ORIGIN}/ws`, {
      transports: ['websocket'],
      withCredentials: true,
      auth: { client: 'console' },
    });
    next.on(SOCKET_EVENTS.error, ({ code }: { code: string }) => {
      if (code !== 'UNAUTHENTICATED') return;
      void session.refresh().then((fresh) => {
        if (fresh) next.connect();
      });
    });
    setSocket(next);
    return () => {
      next.disconnect();
    };
  }, []);
  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

/** Calls `handler` for each `event` while mounted; the latest handler, without resubscribing. */
export function useSocketEvent<K extends SocketEventKey>(
  event: K,
  handler: (payload: SocketPayload<K>) => void,
): void {
  const socket = useContext(SocketContext);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (socket === null) return;
    // The event's name is generic here, which socket.io's listener type cannot narrow.
    const listener = ((payload: SocketPayload<K>) => latest.current(payload)) as never;
    socket.on(SOCKET_EVENTS[event], listener);
    return () => {
      socket.off(SOCKET_EVENTS[event], listener);
    };
  }, [socket, event]);
}

/**
 * Follows one job's tasks (`narration:task:progress`) while mounted: `job:subscribe` after the
 * socket is ready, again after a reconnect, and `job:unsubscribe` when done.
 */
export function useJobSubscription(jobId: string | null): void {
  const socket = useContext(SocketContext);
  useEffect(() => {
    if (socket === null || jobId === null) return;
    const subscribe = () => socket.emit(SOCKET_EVENTS.jobSubscribe, { jobId });
    socket.on(SOCKET_EVENTS.connectionReady, subscribe);
    if (socket.connected) subscribe();
    return () => {
      socket.off(SOCKET_EVENTS.connectionReady, subscribe);
      socket.emit(SOCKET_EVENTS.jobUnsubscribe, { jobId });
    };
  }, [socket, jobId]);
}
