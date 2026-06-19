#!/usr/bin/env tsx
/**
 * Restore PostgreSQL database from a pg_dump custom-format file.
 *
 * Default input: data/backups/localizer.dump
 *
 * Uses pg_restore against DATABASE_URL (remote Postgres). Falls back to
 * `docker run postgres:17 pg_restore` when client tools are not on PATH.
 *
 * Usage:
 *   npm run db:restore -- --yes
 *   npm run db:restore -- --yes --file data/backups/my-backup.dump
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { log } from '../src/logger';
import { DEFAULT_DUMP_FILENAME, resolveDumpPath, restoreDatabase } from './dbBackupShared';

const argv = await yargs(hideBin(process.argv))
  .scriptName('db:restore')
  .usage('$0 [options]')
  .option('file', {
    type: 'string',
    describe: `Dump file to restore (default: data/backups/${DEFAULT_DUMP_FILENAME})`,
  })
  .option('yes', {
    type: 'boolean',
    default: false,
    describe: 'Confirm destructive restore (required)',
  })
  .help()
  .parse();

if (!argv.yes) {
  log.error(
    'Refusing to restore DB without explicit confirmation. Re-run with: npm run db:restore -- --yes',
  );
  process.exit(1);
}

const inFile = resolveDumpPath(argv.file);
await restoreDatabase(inFile);
