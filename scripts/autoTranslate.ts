#!/usr/bin/env tsx
/**
 * Batch LLM translation for mod strings (skips rows with global `is_ignored`).
 *
 * Run `npm run skip:detect` first to mark non-translatable strings.
 *
 * Mod selector (exactly one required):
 *   --mod-id <ids>      Comma-separated database mod ids
 *   --mod-name <name>   Exact mod name (must be unique)
 *   --all               Every mod with a completed import job
 *
 * Overwrite modes (for `--tgt-lang`):
 *   (default)           Untranslated rows only
 *   --force             Non-verified rows (draft, tm, fuzzy, auto, …)
 *   --force-all         Every non-skipped row, including human/reviewed/rejected
 *
 * Pipeline (default): TM auto-apply for exact matches, then LLM for the rest.
 *
 * Usage:
 *   npm run translate:auto -- [options]
 *
 * Options:
 *   --src-lang <code>   Source language override (default: per-mod import or SRC_LANG)
 *   --tgt-lang <code>   Target translation language (default: TGT_LANG)
 *   --no-tm             Skip TM auto-apply (LLM only)
 *   --no-llm            Skip LLM (TM only)
 *   --db-chunk <n>      DB page size for large mods (default: service default)
 *   --no-rag            Disable reference-example search (no TM, no embedding)
 *   --rag-mod-only      Search reference examples only within the current mod
 *
 * Examples:
 *   npm run translate:auto -- --mod-id 45
 *   npm run translate:auto -- --mod-name "MyMod.esp"
 *   npm run translate:auto -- --all
 *   npm run translate:auto -- --mod-id 45 --force
 *   npm run translate:auto -- --mod-id 45 --force-all
 *   npm run translate:auto -- --mod-id 45 --no-tm
 *   npm run translate:auto -- --mod-id 45 --no-llm
 *   npm run translate:auto -- --mod-id 45 --tgt-lang uk --no-rag
 *   npm run translate:auto -- --mod-id 1,2,3 --rag-mod-only --db-chunk 500
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import {
  LLM_TRANSLATE_DB_CHUNK_SIZE,
  type LlmTranslateOverwriteMode,
} from '../src/web/llm/llmTranslateService';
import {
  runCliModTranslate,
  type CliTranslateProgressEvent,
} from '../src/web/llm/cliAutoTranslate';
import { getModStats } from '../src/web/data/queries';
import { applyTMToMod } from '../src/web/services/tm';
import {
  assertCliModSelector,
  formatPct,
  resolveCliModTargets,
  type CliModTarget,
} from './cliModTargets';
import {
  addCliRagFlagOptions,
  assertCliRagFlags,
  formatCliRagFlags,
  readCliRagFlags,
  toRagRetrievalOptions,
} from './cliRagFlags';

type ModStats = {
  total: number;
  translated: number;
  untranslated: number;
  skipped: number;
  auto_translated: number;
  draft: number;
  approved: number;
};

const toModStats = (row: Record<string, unknown> | undefined): ModStats => ({
  total: Number(row?.total ?? 0),
  translated: Number(row?.translated ?? 0),
  untranslated: Number(row?.untranslated ?? 0),
  skipped: Number(row?.skipped ?? 0),
  auto_translated: Number(row?.auto_translated ?? 0),
  draft: Number(row?.draft ?? 0),
  approved: Number(row?.approved ?? 0),
});

const formatModStats = (stats: ModStats): string =>
  `total=${stats.total}, untranslated=${stats.untranslated}, translated=${stats.translated}, ` +
  `skipped=${stats.skipped}, auto=${stats.auto_translated}, draft=${stats.draft}, approved=${stats.approved}`;

const resolveOverwriteMode = (force: boolean, forceAll: boolean): LlmTranslateOverwriteMode => {
  if (forceAll) return 'force-all';
  if (force) return 'force';
  return 'default';
};

const startedLogLine = (
  mode: LlmTranslateOverwriteMode,
  total: number,
  dbChunkSize: number,
): string => {
  switch (mode) {
    case 'default':
      return `Translate: ${total} untranslated string(s), db-chunk=${dbChunkSize}`;
    case 'force':
      return `Translate (force): ${total} string(s) (all except verified), db-chunk=${dbChunkSize}`;
    case 'force-all':
      return `Translate (force-all): ${total} string(s) (all non-skipped), db-chunk=${dbChunkSize}`;
  }
};

const skippedLogLine = (mode: LlmTranslateOverwriteMode, modId: number): string => {
  switch (mode) {
    case 'default':
      return `Translate: nothing to do (mod_id=${modId}) — all strings already translated or skipped`;
    case 'force':
      return `Translate: nothing to do (mod_id=${modId}) — no eligible rows (skipped or verified)`;
    case 'force-all':
      return `Translate: nothing to do (mod_id=${modId}) — no non-skipped rows`;
  }
};

const argv = await addCliRagFlagOptions(
  yargs(hideBin(process.argv))
    .scriptName('translate:auto')
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
    .option('tgt-lang', {
      type: 'string',
      default: CONFIG.defaultTgtLang,
      describe: 'Target translation language (default: TGT_LANG)',
    })
    .option('force', {
      type: 'boolean',
      default: false,
      describe: 'Also overwrite draft/tm/fuzzy (still skips verified human/reviewed/rejected)',
    })
    .option('force-all', {
      type: 'boolean',
      default: false,
      describe: 'Overwrite every non-skipped row, including verified translations',
    })
    .option('tm', {
      type: 'boolean',
      default: true,
      describe: 'Run TM auto-apply before LLM (disable with --no-tm)',
    })
    .option('llm', {
      type: 'boolean',
      default: true,
      describe: 'Run LLM translation after TM (disable with --no-llm)',
    })
    .option('db-chunk', {
      type: 'number',
      describe: `DB page size for large mods (default: ${LLM_TRANSLATE_DB_CHUNK_SIZE})`,
    }),
)
  .check((args) => {
    assertCliModSelector({
      all: args.all,
      modId: args['mod-id'],
      modName: args['mod-name'],
    });
    if (args['force-all'] && args.force) {
      throw new Error('Use either --force or --force-all, not both');
    }
    if (args.tm === false && args.llm === false) {
      throw new Error('Cannot use --no-tm and --no-llm together (nothing to run)');
    }
    assertCliRagFlags({
      noRag: args.rag === false,
      ragModOnly: args.ragModOnly === true,
    });
    return true;
  })
  .help()
  .parse();

validateConfig();

const ragFlags = readCliRagFlags(argv);

const tgtLang = argv['tgt-lang'].trim();
const useTm = argv.tm;
const useLlm = argv.llm;
const overwriteMode = resolveOverwriteMode(argv.force, argv['force-all']);
const dbChunkSize =
  argv['db-chunk'] != null ? Math.max(50, argv['db-chunk']) : LLM_TRANSLATE_DB_CHUNK_SIZE;

const db = openDb();

const loadModStats = async (modId: number, srcLang: string): Promise<ModStats> => {
  const row = await getModStats(db, modId, srcLang, tgtLang);
  return toModStats(row as Record<string, unknown>);
};

const logTranslateProgress = (
  ctx: { lastLogged: { done: number }; ok: number; errors: number; startedAt: number },
  event: CliTranslateProgressEvent,
): void => {
  if (event.type === 'started') {
    ctx.startedAt = Date.now();
    log.info(startedLogLine(event.overwriteMode, event.total, event.dbChunkSize));
    return;
  }
  if (event.type === 'progress') {
    if (event.result?.error) ctx.errors++;
    else if (event.result?.text) ctx.ok++;
    const step = event.total >= 500 ? 100 : event.total >= 100 ? 50 : 25;
    if (event.done === event.total || event.done - ctx.lastLogged.done >= step) {
      ctx.lastLogged.done = event.done;
      const elapsedSec = (Date.now() - ctx.startedAt) / 1000;
      const rate = elapsedSec > 0 ? (event.done / elapsedSec).toFixed(1) : '—';
      const errSuffix = event.result?.error ? `, last error: ${event.result.error}` : '';
      log.info(
        `Translate: ${event.done}/${event.total} (${formatPct(event.done, event.total)}), ` +
          `ok=${event.ok}, errors=${event.errors}, page=${event.dbPage}, ~${rate}/s${errSuffix}`,
      );
    }
    return;
  }
  if (event.type === 'done') {
    const elapsedSec = (Date.now() - ctx.startedAt) / 1000;
    log.info(
      `Translate done: ${event.done}/${event.total} (${formatPct(event.done, event.total)}), ` +
        `ok=${event.ok}, errors=${event.errors}, elapsed=${elapsedSec.toFixed(0)}s`,
    );
    return;
  }
  if (event.type === 'error') {
    log.error(`Translate error: ${event.error}`);
  }
};

const processMod = async (target: CliModTarget): Promise<'ok' | 'failed' | 'skipped'> => {
  const statsBefore = await loadModStats(target.modId, target.srcLang);
  log.info(
    `Processing mod_id=${target.modId} "${target.modName}" (src=${target.srcLang}, tgt=${tgtLang}, game=${target.game})`,
  );
  log.info(`Before: ${formatModStats(statsBefore)}`);

  if (useTm) {
    log.info(
      `TM auto-apply: mod_id=${target.modId} (chunk=${CONFIG.tmApplyChunkSize}, workers=${CONFIG.tmApplyWorkers})`,
    );
    const tm = await applyTMToMod(db, target.modId, tgtLang, target.srcLang);
    log.info(
      `TM auto-apply done: applied=${tm.applied}, skipped=${tm.skipped}, ` +
        `anchor=${tm.byMethod.anchor ?? 0}, edid=${tm.byMethod.edid ?? 0}, text_norm=${tm.byMethod.text_norm ?? 0}`,
    );
    const statsAfterTm = await loadModStats(target.modId, target.srcLang);
    log.info(`After TM: ${formatModStats(statsAfterTm)}`);
  }

  if (!useLlm) {
    const statsAfter = await loadModStats(target.modId, target.srcLang);
    log.info(`After: ${formatModStats(statsAfter)}`);
    log.info(
      `Mod summary: translated +${statsAfter.translated - statsBefore.translated}, ` +
        `untranslated ${statsBefore.untranslated} → ${statsAfter.untranslated}`,
    );
    if (statsAfter.untranslated > 0) {
      log.warn(`TM-only: ${statsAfter.untranslated} string(s) still untranslated (no LLM pass)`);
    }
    return 'ok';
  }

  const ctx = { lastLogged: { done: 0 }, ok: 0, errors: 0, startedAt: Date.now() };
  try {
    const summary = await runCliModTranslate(
      db,
      {
        modId: target.modId,
        srcLang: target.srcLang,
        targetLang: tgtLang,
        modName: target.modName,
        game: target.game,
        dbChunkSize,
        overwriteMode,
        rag: toRagRetrievalOptions(ragFlags, target.modId),
      },
      (event) => logTranslateProgress(ctx, event),
    );

    const statsAfter = await loadModStats(target.modId, target.srcLang);
    log.info(`After: ${formatModStats(statsAfter)}`);
    log.info(
      `Mod summary: translated +${statsAfter.translated - statsBefore.translated}, ` +
        `untranslated ${statsBefore.untranslated} → ${statsAfter.untranslated}`,
    );

    if (summary.errors > 0 && summary.ok === 0) {
      log.error(
        `Translate failed for mod_id=${target.modId}: all ${summary.errors} string(s) errored`,
      );
      return 'failed';
    }
    if (summary.errors > 0) {
      log.warn(`Translate finished with ${summary.errors} error(s) (mod_id=${target.modId})`);
    }
    return 'ok';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith('No strings to translate')) {
      const statsAfter = await loadModStats(target.modId, target.srcLang);
      log.info(`After: ${formatModStats(statsAfter)}`);
      if (useTm && statsAfter.translated > statsBefore.translated) {
        log.info(
          `Translate: LLM skipped (mod_id=${target.modId}) — no rows left after TM; ` +
            `translated +${statsAfter.translated - statsBefore.translated}`,
        );
        return 'ok';
      }
      log.info(skippedLogLine(overwriteMode, target.modId));
      return 'skipped';
    }
    log.error(`Translate failed for mod_id=${target.modId}: ${message}`);
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

  log.info(
    `Translate: ${targets.length} mod(s), tm=${useTm}, llm=${useLlm}, overwriteMode=${overwriteMode}, ${formatCliRagFlags(ragFlags)}, dbChunk=${dbChunkSize}, llmRetries=${CONFIG.llmMaxAttempts}`,
  );

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const target of targets) {
    const result = await processMod(target);
    if (result === 'ok') ok++;
    else if (result === 'skipped') skipped++;
    else failed++;
  }

  log.info(`Translate complete: ok=${ok}, skipped=${skipped}, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
} finally {
  await closeDb();
}
