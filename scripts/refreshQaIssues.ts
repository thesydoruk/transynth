#!/usr/bin/env tsx
/**
 * Recompute QA issues for translations that already exist.
 *
 * Needed after a new QA rule ships: normal QA runs are triggered by an edit,
 * so a rule added today never looks at yesterday's translations.
 *
 * Usage:
 *   npm run qa:refresh -- [options]
 *
 * Options:
 *   --target-lang <lang>  Language to recheck (default: configured target)
 *   --mod-id <id>         Single mod (default: every mod)
 *   --dialogs-only        Only dialog lines (INFO responses and prompts)
 *   --chunk <n>           Strings per batch (default: 2000)
 *   --dry-run             Print what would be rechecked and exit
 *
 * Examples:
 *   npm run qa:refresh -- --dialogs-only --dry-run
 *   npm run qa:refresh -- --dialogs-only
 *   npm run qa:refresh -- --mod-id 102 --target-lang uk
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import {
  countQaRefreshTargets,
  listQaRefreshTargetIds,
  refreshQAIssuesBatch,
  type QaRefreshScope,
} from '../src/web/data/queries';

const argv = await yargs(hideBin(process.argv))
  .scriptName('qa:refresh')
  .usage('$0 [options]')
  .option('target-lang', {
    type: 'string',
    describe: 'Language to recheck',
  })
  .option('mod-id', {
    type: 'number',
    describe: 'Single mod to recheck (default: every mod)',
  })
  .option('dialogs-only', {
    type: 'boolean',
    default: false,
    describe: 'Only dialog lines (INFO responses and prompts)',
  })
  .option('chunk', {
    type: 'number',
    default: 2_000,
    describe: 'Strings per batch',
  })
  .option('dry-run', {
    type: 'boolean',
    default: false,
    describe: 'Print what would be rechecked and exit',
  })
  .help()
  .parse();

validateConfig();

const db = openDb();

const scope: QaRefreshScope = {
  targetLang: argv['target-lang'] ?? CONFIG.defaultTgtLang,
  modId: argv['mod-id'],
  dialogsOnly: argv['dialogs-only'],
};

const run = async (): Promise<void> => {
  const counts = await countQaRefreshTargets(db, scope);
  const total = counts.reduce((sum, row) => sum + row.strings, 0);

  log.info(
    `QA refresh scope: lang=${scope.targetLang}` +
      (scope.modId != null ? `, mod_id=${scope.modId}` : '') +
      (scope.dialogsOnly ? ', dialog lines only' : '') +
      ` — ${total} string(s) across ${counts.length} mod(s)`,
  );
  for (const row of counts) {
    log.info(`  mod_id=${row.mod_id} "${row.mod_name}" — ${row.strings} string(s)`);
  }

  if (total === 0 || argv['dry-run']) return;

  const stringIds = await listQaRefreshTargetIds(db, scope);
  const chunk = Math.max(1, argv.chunk);
  let done = 0;

  for (let i = 0; i < stringIds.length; i += chunk) {
    await refreshQAIssuesBatch(db, stringIds.slice(i, i + chunk), scope.targetLang);
    done += Math.min(chunk, stringIds.length - i);
    log.info(`  ${done}/${stringIds.length} string(s) rechecked`);
  }

  log.info(`Done: ${done} string(s) rechecked for "${scope.targetLang}"`);
};

try {
  await run();
} finally {
  await closeDb();
}
