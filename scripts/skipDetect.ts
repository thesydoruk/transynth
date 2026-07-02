#!/usr/bin/env tsx
/**
 * Scan mod strings and mark non-translatable rows (global `strings.is_ignored` flag).
 *
 * Heuristics run first; LLM audit follows by default. Skip marks apply to the
 * source string for all target languages — not per-locale translation status.
 *
 * Usage:
 *   npm run skip:detect -- --mod-id 45
 *   npm run skip:detect -- --mod-name "MyMod.esp"
 *   npm run skip:detect -- --all
 *   npm run skip:detect -- --mod-id 45 --heuristic-only
 *   npm run skip:detect -- --mod-id 45 --force
 *
 * RAG flags (--no-rag, --rag-mod-only) are accepted for CLI consistency but have no
 * effect here — skip-detect does not use reference-example search.
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import {
  runLlmSkipDetectJob,
  scheduleLlmSkipDetectJobCleanup,
  type LlmSkipDetectProgressEvent,
} from '../src/web/llmSkipDetectService';
import { getModStats } from '../src/web/queries';
import {
  assertCliModSelector,
  formatPct,
  resolveCliModTargets,
  type CliModTarget,
} from './cliModTargets';
import { addCliRagFlagOptions, assertCliRagFlags } from './cliRagFlags';

type ModStats = {
  total: number;
  translated: number;
  untranslated: number;
  skipped: number;
};

const toModStats = (row: Record<string, unknown> | undefined): ModStats => ({
  total: Number(row?.total ?? 0),
  translated: Number(row?.translated ?? 0),
  untranslated: Number(row?.untranslated ?? 0),
  skipped: Number(row?.skipped ?? 0),
});

const formatModStats = (stats: ModStats): string =>
  `total=${stats.total}, untranslated=${stats.untranslated}, translated=${stats.translated}, skipped=${stats.skipped}`;

const argv = await addCliRagFlagOptions(
  yargs(hideBin(process.argv))
    .scriptName('skip:detect')
    .usage('$0 [options]')
    .option('mod-id', {
      type: 'string',
      describe: 'Comma-separated database mod ids',
    })
    .option('mod-name', {
      type: 'string',
      describe: 'Exact mod name (must be unique in the database)',
    })
    .option('all', {
      type: 'boolean',
      default: false,
      describe: 'Process every mod with a completed import job',
    })
    .option('src-lang', {
      type: 'string',
      describe: 'Source language override (default: mod import or SRC_LANG)',
    })
    .option('heuristic-only', {
      type: 'boolean',
      default: false,
      describe: 'Heuristics only (no LLM audit)',
    })
    .option('use-llm', {
      type: 'boolean',
      default: true,
      describe: 'Run LLM skip detection after heuristics (default: true)',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      describe: 'Re-scan all strings, including already marked or previously scanned',
    }),
)
  .check((args) => {
    assertCliModSelector({
      all: args.all,
      modId: args['mod-id'],
      modName: args['mod-name'],
    });
    assertCliRagFlags({
      noRag: args.noRag === true,
      ragModOnly: args.ragModOnly === true,
    });
    return true;
  })
  .help()
  .parse();

validateConfig();

const useLlm = argv['heuristic-only'] ? false : argv['use-llm'];
const force = argv['force'];

const db = openDb();

const loadModStats = async (modId: number, srcLang: string): Promise<ModStats> => {
  const row = await getModStats(db, modId, srcLang, CONFIG.defaultTgtLang);
  return toModStats(row as Record<string, unknown>);
};

const logSkipProgress = (
  ctx: { lastLogged: { done: number }; candidates: number; marked: number },
  event: LlmSkipDetectProgressEvent,
): void => {
  if (event.type === 'started') {
    log.info(
      `Skip detect: scanning ${event.total} string(s) (heuristics${event.useLlm ? ' + LLM' : ''}${event.persist ? ', persist' : ''})`,
    );
    return;
  }
  if (event.type === 'progress') {
    if (event.candidate) ctx.candidates++;
    if (event.marked) ctx.marked += event.marked;
    const step = event.total >= 500 ? 100 : event.total >= 100 ? 50 : 25;
    if (event.done === event.total || event.done - ctx.lastLogged.done >= step) {
      ctx.lastLogged.done = event.done;
      log.info(
        `Skip detect: ${event.done}/${event.total} (${formatPct(event.done, event.total)}), candidates=${ctx.candidates}`,
      );
    }
    return;
  }
  if (event.type === 'done') {
    log.info(
      `Skip detect done: ${event.done}/${event.total} (${formatPct(event.done, event.total)}), candidates=${event.candidates.length}, marked=${event.markedCount}`,
    );
    return;
  }
  if (event.type === 'cancelled') {
    log.warn(
      `Skip detect cancelled: ${event.done}/${event.total} (${formatPct(event.done, event.total)}), candidates=${event.candidates.length}, marked=${event.markedCount}`,
    );
    return;
  }
  if (event.type === 'error') {
    log.error(`Skip detect error: ${event.error}`);
  }
};

const processMod = async (target: CliModTarget): Promise<'ok' | 'failed' | 'skipped'> => {
  const statsBefore = await loadModStats(target.modId, target.srcLang);
  log.info(
    `Processing mod_id=${target.modId} "${target.modName}" (src=${target.srcLang}, game=${target.game})`,
  );
  log.info(`Before: ${formatModStats(statsBefore)}`);

  const ctx = { lastLogged: { done: 0 }, candidates: 0, marked: 0 };
  try {
    const snapshot = await runLlmSkipDetectJob(
      db,
      {
        modId: target.modId,
        srcLang: target.srcLang,
        modName: target.modName,
        game: target.game,
        useLlm,
        persist: true,
        force,
      },
      (event) => logSkipProgress(ctx, event),
    );
    scheduleLlmSkipDetectJobCleanup(snapshot.jobId);

    if (snapshot.status === 'failed') {
      log.error(
        `Skip detect failed for mod_id=${target.modId}: ${snapshot.error ?? 'unknown error'}`,
      );
      return 'failed';
    }

    const statsAfter = await loadModStats(target.modId, target.srcLang);
    log.info(`After: ${formatModStats(statsAfter)}`);
    log.info(
      `Mod summary: skipped +${statsAfter.skipped - statsBefore.skipped}, ` +
        `untranslated ${statsBefore.untranslated} → ${statsAfter.untranslated}`,
    );

    if (snapshot.markedCount === 0 && snapshot.candidates.length === 0) {
      log.info(`No skip candidates for mod_id=${target.modId}`);
    } else {
      log.info(
        `Skip detect marked ${snapshot.markedCount} string(s) as non-translatable (mod_id=${target.modId})`,
      );
    }
    return 'ok';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('No strings to scan')) {
      log.info(
        `Skip detect: nothing to scan (mod_id=${target.modId}) — all strings already marked or absent`,
      );
      return 'skipped';
    }
    log.error(`Skip detect failed for mod_id=${target.modId}: ${message}`);
    return 'failed';
  }
};

try {
  const targets = await resolveCliModTargets(db, {
    all: argv.all,
    modId: argv['mod-id'],
    modName: argv['mod-name'],
    srcLang: argv['src-lang'],
  });
  if (targets.length === 0) {
    log.warn('No mods found');
    process.exit(0);
  }

  log.info(`Skip detect: ${targets.length} mod(s), useLlm=${useLlm}, force=${force}`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const target of targets) {
    const result = await processMod(target);
    if (result === 'ok') ok++;
    else if (result === 'skipped') skipped++;
    else failed++;
  }

  log.info(`Skip detect complete: ok=${ok}, skipped=${skipped}, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
} finally {
  await closeDb();
}
