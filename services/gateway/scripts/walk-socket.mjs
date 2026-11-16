// The live walk's socket client (api-endpoints-plan §9): connects as the console does, optionally
// subscribes to a job, and appends every frame to a file as a JSON line until it is stopped.
//
// Usage: node walk-socket.mjs OUT_FILE [JOB_ID]
//   WS_URL (default http://localhost:13000/ws), ORIGIN (default http://localhost:5173) and TOKEN
//   (the wf_at access token) come from the environment.
import { appendFileSync } from 'node:fs';
import { io } from 'socket.io-client';

const [out, jobId] = process.argv.slice(2);
if (out === undefined) {
  console.error('usage: node walk-socket.mjs OUT_FILE [JOB_ID]');
  process.exit(2);
}
const record = (event, payload) =>
  appendFileSync(out, `${JSON.stringify({ at: Date.now(), event, payload })}\n`);

const socket = io(process.env.WS_URL ?? 'http://localhost:13000/ws', {
  transports: ['websocket'],
  auth: { client: 'console' },
  extraHeaders: {
    Origin: process.env.ORIGIN ?? 'http://localhost:5173',
    Cookie: `wf_at=${process.env.TOKEN ?? ''}`,
  },
  reconnection: false,
});

socket.onAny((event, payload) => {
  record(event, payload);
  if (event === 'connection:ready' && jobId !== undefined) socket.emit('job:subscribe', { jobId });
});
socket.on('disconnect', (reason) => record('disconnect', { reason }));
socket.on('connect_error', (error) => {
  record('connect_error', { message: error.message });
  process.exit(1);
});
process.on('SIGTERM', () => {
  socket.disconnect();
  process.exit(0);
});
