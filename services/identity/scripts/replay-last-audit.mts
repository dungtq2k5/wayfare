// Redelivery proof: republishes the last `audit.record` message under a NEW, valid UUIDv7
// `Nats-Msg-Id`, so the broker does not dedupe it and the consumer genuinely receives it twice.
// Passes only when the event still has exactly one audit_logs row AND the replay did not land on
// the dead-letter subject — an unchanged count with a new dead letter means it was rejected,
// not absorbed.
//
// Usage: pnpm --filter @wayfare/identity replay:last-audit   (identity must be running)
import 'dotenv/config';
import jetstreamPkg from '@nats-io/jetstream';
import transportPkg from '@nats-io/transport-node';
import contracts from '@wayfare/contracts';
import pg from 'pg';

const { jetstreamManager, jetstream } = jetstreamPkg;
const { connect, headers } = transportPkg;
const { AUDIT_RECORD, dlqSubject, durableName, newId } = contracts;

const SERVICE = 'identity';
const durable = durableName(SERVICE, AUDIT_RECORD.subject);
const deadLetters = dlqSubject(SERVICE, durable);

const nc = await connect({ servers: process.env.NATS_URL });
const jsm = await jetstreamManager(nc);
const js = jetstream(nc);
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function dlqCount(): Promise<number> {
  try {
    const info = await jsm.streams.info('DLQ', { subjects_filter: deadLetters });
    return info.state.subjects?.[deadLetters] ?? 0;
  } catch {
    return 0;
  }
}

async function auditRows(eventId: string): Promise<number> {
  const result = await db.query<{ count: string }>(
    'SELECT count(*) FROM audit_logs WHERE event_id = $1',
    [eventId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function waitForConsumerIdle(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await jsm.consumers.info(AUDIT_RECORD.stream, durable);
    if (info.num_pending === 0 && info.num_ack_pending === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`consumer ${durable} did not settle within ${timeoutMs} ms`);
}

try {
  // 1. The last message on the AUDIT stream, as raw bytes — not the CLI's formatted view.
  const last = await jsm.streams.getMessage(AUDIT_RECORD.stream, {
    last_by_subj: AUDIT_RECORD.subject,
  });
  if (!last)
    throw new Error('the AUDIT stream has no audit.record message yet — register a device first');
  const payload = JSON.parse(new TextDecoder().decode(last.data)) as { eventId: string };
  const originalId = last.header?.get('Nats-Msg-Id') ?? '(none)';

  const dlqBefore = await dlqCount();
  const rowsBefore = await auditRows(payload.eventId);

  // 2. The exact payload again, under a new valid UUIDv7 header.
  const replayId = newId();
  const bag = headers();
  bag.set('Nats-Msg-Id', replayId);
  await js.publish(AUDIT_RECORD.subject, last.data, { msgID: replayId, headers: bag });

  // 3. Wait for the consumer to acknowledge it, then read the outcome.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await waitForConsumerIdle(10_000);
  const rowsAfter = await auditRows(payload.eventId);
  const dlqAfter = await dlqCount();

  console.log(`eventId            ${payload.eventId}`);
  console.log(`original msg id    ${originalId}`);
  console.log(`replay msg id      ${replayId}`);
  console.log(`audit_logs rows    ${rowsBefore} → ${rowsAfter}`);
  console.log(`dead letters       ${dlqBefore} → ${dlqAfter} (${deadLetters})`);

  const passed = rowsAfter === 1 && dlqAfter === dlqBefore;
  console.log(
    passed ? 'PASS — the replay was absorbed' : 'FAIL — the replay was not absorbed exactly once',
  );
  process.exitCode = passed ? 0 : 1;
} finally {
  await db.end();
  await nc.drain();
}
