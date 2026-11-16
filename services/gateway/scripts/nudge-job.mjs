// Runs one scheduled job now: `node nudge-job.mjs <queue> <job>` adds it to the service's job
// queue, where its own worker picks it up. Used by the live walks, which cannot wait a quarter of
// an hour for a job whose schedule is measured in minutes.
//
// Usage: node nudge-job.mjs identity-jobs account-recoveries-advance
//   Run it from the service's own directory: REDIS_URL comes from that service's .env.
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
// `bullmq` belongs to nest-common, which owns the queues; pnpm keeps each package's dependencies
// to itself, so it is resolved from there rather than from wherever this script was started.
const nestCommon = join(import.meta.dirname, '..', '..', '..', 'packages', 'nest-common');
const { Queue } = require(require.resolve('bullmq', { paths: [nestCommon] }));
require(require.resolve('dotenv/config', { paths: [process.cwd()] }));

const [queueName, jobName] = process.argv.slice(2);
if (!queueName || !jobName) {
  console.error('usage: node nudge-job.mjs <queue> <job>');
  process.exit(1);
}

const queue = new Queue(queueName, { connection: { url: process.env.REDIS_URL } });
await queue.add(jobName, {}, { removeOnComplete: true, removeOnFail: true });
await queue.close();
console.log(`queued ${jobName}`);
