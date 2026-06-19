#!/usr/bin/env tsx
/**
 * Dump PostgreSQL database to a custom-format file (pg_dump -Fc).
 *
 * Default output: data/backups/localizer.dump
 *
 * Uses pg_dump against DATABASE_URL (remote Postgres). Falls back to
 * `docker run postgres:17 pg_dump` when client tools are not on PATH.
 *
 * Usage:
 *   npm run db:dump
 *   npm run db:dump -- --out data/backups/my-backup.dump
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { DEFAULT_DUMP_FILENAME, dumpDatabase, resolveDumpPath } from './dbBackupShared';

const argv = await yargs(hideBin(process.argv))
  .scriptName('db:dump')
  .usage('$0 [options]')
  .option('out', {
    type: 'string',
    describe: `Output dump path (default: data/backups/${DEFAULT_DUMP_FILENAME})`,
  })
  .help()
  .parse();

const outFile = resolveDumpPath(argv.out);
await dumpDatabase(outFile);
