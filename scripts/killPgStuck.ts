#!/usr/bin/env tsx
/**
 * List and terminate stuck PostgreSQL sessions.
 *
 * Usage:
 *   npx tsx scripts/killPgStuck.ts           # list sessions
 *   npx tsx scripts/killPgStuck.ts --kill    # terminate active / idle-in-tx
 *   npx tsx scripts/killPgStuck.ts --kill --pid=12345
 */
import '../src/loadEnv';
import pg from 'pg';

const { Pool } = pg;
const killMode = process.argv.includes('--kill');
const pidArg = process.argv.find((a) => a.startsWith('--pid='));
const targetPid = pidArg ? Number(pidArg.split('=')[1]) : null;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type ActivityRow = {
  pid: number;
  usename: string;
  state: string;
  wait_event_type: string | null;
  wait_event: string | null;
  xact_age: unknown;
  query_age: unknown;
  query: string | null;
};

const { rows } = await pool.query<ActivityRow>(`
  SELECT pid, usename, state, wait_event_type, wait_event,
         now() - xact_start AS xact_age,
         now() - query_start AS query_age,
         left(query, 200) AS query
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid()
  ORDER BY coalesce(xact_start, query_start) NULLS LAST
`);

if (rows.length === 0) {
  console.log('No other sessions on this database.');
  await pool.end();
  process.exit(0);
}

console.log('Active sessions:');
for (const row of rows) {
  console.log(
    `  pid=${row.pid} state=${row.state} wait=${row.wait_event_type}/${row.wait_event} xact=${row.xact_age} query=${row.query_age}`,
  );
  if (row.query) console.log(`    ${row.query.replace(/\s+/g, ' ').trim()}`);
}

const toKill =
  targetPid != null
    ? rows.filter((r) => r.pid === targetPid)
    : rows.filter(
        (r) =>
          r.state === 'idle in transaction' ||
          r.state === 'active' ||
          r.state === 'idle in transaction (aborted)',
      );

if (!killMode) {
  console.log(`\nRe-run with --kill to terminate ${toKill.length} session(s).`);
  if (targetPid == null) console.log('Or pass --pid=N for a specific session.');
  await pool.end();
  process.exit(0);
}

for (const row of toKill) {
  console.log(`Terminating pid=${row.pid}...`);
  await pool.query('SELECT pg_terminate_backend($1)', [row.pid]);
}

console.log(`Done. Terminated ${toKill.length} session(s).`);
await pool.end();
