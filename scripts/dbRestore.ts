#!/usr/bin/env tsx
/**
 * Restore PostgreSQL database from a pg_dump custom-format file.
 *
 * Destructive — replaces existing data in the target database. Requires `--yes`.
 * Uses pg_restore against DATABASE_URL. Falls back to `docker run postgres:17 pg_restore`
 * when client tools are not on PATH.
 *
 * Usage:
 *   npm run db:restore -- --yes [options]
 *
 * Options:
 *   --file <path>   Dump file to restore (default: data/backups/localizer.dump)
 *   --yes           Confirm destructive restore (required)
 *
 * Examples:
 *   npm run db:restore -- --yes
 *   npm run db:restore -- --yes --file data/backups/my-backup.dump
 *
 * Environment:
 *   DATABASE_URL   PostgreSQL connection string (see .env.example)
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
