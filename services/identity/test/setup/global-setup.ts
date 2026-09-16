// Migrate once, apply schema objects, and verify them before any suite runs, so a missing index
// fails a test before it fails a write (ADR 0034, ADR 0045).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function setup(): void {
  const cwd = resolve(__dirname, '../..');
  const bin = (name: string) => resolve(cwd, 'node_modules/.bin', name);
  const env = { ...process.env, PRISMA_DB: 'test' };
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { cwd, env, stdio: 'pipe' });
  run(bin('prisma'), ['migrate', 'deploy']);
  run(bin('prisma'), ['db', 'execute', '--file', 'prisma/sql/schema-objects.sql']);
  run(bin('wayfare-db-verify'), []);
}
