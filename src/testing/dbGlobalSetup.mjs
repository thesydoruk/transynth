/**
 * Jest global setup for the database suite: start every run on an empty
 * database. The schema itself is applied by each test file (see testDb.ts),
 * which also exercises `db:init` being safe to re-run.
 */
import pg from 'pg';
import { resolveTestDatabaseUrl } from './testDbUrl.mjs';

export default async () => {
  const { url, name } = resolveTestDatabaseUrl();
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const client = new pg.Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach the test database server at ${admin.host} (${err.message}). ` +
        'Start it with `npm run test:db:up`, or point TEST_DATABASE_URL at another server.',
    );
  }
  try {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    await client.query(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${quoted}`);
  } finally {
    await client.end();
  }
};
