#!/usr/bin/env tsx
/**
 * Automatic mod localization: mark non-translatable strings, then LLM-translate the rest.
 *
 * Phase 1 — skip detection (heuristics + LLM audit by default) and apply marks.
 * Phase 2 — batch LLM translation for strings without a target-language translation.
 *
 * Usage:
 *   npm run translate:auto -- --mod-id 45
 *   npm run translate:auto -- --mod-name "MyMod.esp"
 *   npm run translate:auto -- --all
 *   npm run translate:auto -- --mod-id 45 --heuristic-only
 *   npm run translate:auto -- --mod-id 45 --force
 *   npm run translate:auto -- --mod-id 45 --translate-only --force
 *   npm run translate:auto -- --mod-id 45 --tgt-lang uk
 *   npm run translate:auto -- --mod-id 45 --skip-only
 *   npm run translate:auto -- --mod-id 45 --translate-only
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import type { GameType } from '../src/types';
import {
  runLlmSkipDetectJob,
  scheduleLlmSkipDetectJobCleanup,
  type LlmSkipDetectProgressEvent,
} from '../src/web/llmSkipDetectService';
import { LLM_TRANSLATE_DB_CHUNK_SIZE } from '../src/web/llmTranslateService';
import { runCliModTranslate, type CliTranslateProgressEvent } from '../src/web/cliAutoTranslate';
import { getModStats } from '../src/web/queries';

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

const formatPct = (done: number, total: number): string => {
  if (total <= 0) return '0%';
  return `${Math.round((done / total) * 100)}%`;
};

const formatModStats = (stats: ModStats): string =>
  `total=${stats.total}, untranslated=${stats.untranslated}, translated=${stats.translated}, ` +
  `skipped=${stats.skipped}, auto=${stats.auto_translated}, draft=${stats.draft}, approved=${stats.approved}`;

const loadModStats = async (modId: number, srcLang: string): Promise<ModStats> => {
  const row = await getModStats(db, modId, srcLang, tgtLang);
  return toModStats(row as Record<string, unknown>);
};

type ModTarget = {
  modId: number;
  modName: string;
  game: GameType;
  srcLang: string;
};

const parseModIds = (raw: string | undefined): number[] | undefined => {
  if (!raw?.trim()) return undefined;
  const ids = raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    throw new Error('--mod-id must list one or more positive integers');
  }
  return ids;
};

const argv = await yargs(hideBin(process.argv))
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
  .option('heuristic-only', {
    type: 'boolean',
    default: false,
    describe: 'Skip detection with heuristics only (no LLM audit)',
  })
  .option('use-llm', {
    type: 'boolean',
    default: true,
    describe: 'Run LLM skip detection after heuristics (default: true)',
  })
  .option('skip-only', {
    type: 'boolean',
    default: false,
    describe: 'Only mark non-translatable strings; do not translate',
  })
  .option('translate-only', {
    type: 'boolean',
    default: false,
    describe: 'Skip non-translatable detection; only translate missing rows',
  })
  .option('force', {
    type: 'boolean',
    default: false,
    describe: 'Re-scan skipped strings; re-translate existing auto/draft rows (not human/reviewed)',
  })
  .option('db-chunk', {
    type: 'number',
    describe: `DB page size for large mods (default: ${LLM_TRANSLATE_DB_CHUNK_SIZE})`,
  })
  .check((args) => {
    const hasTarget = args.all || args['mod-id'] || args['mod-name'];
    if (!hasTarget) {
      throw new Error('Specify --mod-id, --mod-name, or --all');
    }
    if (args.all && (args['mod-id'] || args['mod-name'])) {
      throw new Error('Use either --all or a single-mod selector, not both');
    }
    if (args['mod-id'] && args['mod-name']) {
      throw new Error('Use either --mod-id or --mod-name, not both');
    }
    if (args['skip-only'] && args['translate-only']) {
      throw new Error('Use either --skip-only or --translate-only, not both');
    }
    return true;
  })
  .help()
  .parse();

validateConfig();

const tgtLang = argv['tgt-lang'].trim();
const srcLangOverride = argv['src-lang']?.trim() || undefined;
const useLlm = argv['heuristic-only'] ? false : argv['use-llm'];
const skipForce = argv['force'];
const skipOnly = argv['skip-only'];
const translateOnly = argv['translate-only'];
const dbChunkSize =
  argv['db-chunk'] != null ? Math.max(50, argv['db-chunk']) : LLM_TRANSLATE_DB_CHUNK_SIZE;

const db = openDb();

const listAllModTargets = async (): Promise<ModTarget[]> => {
  const { rows } = await db.query<{
    mod_id: number;
    mod_name: string;
    game: string;
    src_lang: string | null;
  }>(
    `SELECT DISTINCT ON (m.id)
        m.id AS mod_id,
        m.name AS mod_name,
        COALESCE(m.game, mi.game, 'fo4') AS game,
        mi.src_lang
     FROM mods m
     JOIN mod_imports mi ON mi.mod_id = m.id
     WHERE mi.status = 'completed'
       AND mi.mod_id IS NOT NULL
     ORDER BY m.id, mi.updated_at DESC`,
  );

  return rows.map((row) => ({
    modId: row.mod_id,
    modName: row.mod_name,
    game: row.game as GameType,
    srcLang: srcLangOverride ?? row.src_lang?.trim() ?? CONFIG.defaultSrcLang,
  }));
};

const resolveModTargets = async (): Promise<ModTarget[]> => {
  if (argv.all) {
    return listAllModTargets();
  }

  let modIds: number[];
  if (argv['mod-name']) {
    const name = argv['mod-name'].trim();
    const { rows } = await db.query<{ id: number }>(
      `SELECT id FROM mods WHERE name ILIKE $1 ORDER BY id LIMIT 2`,
      [name],
    );
    if (rows.length === 0) throw new Error(`Mod not found: "${name}"`);
    if (rows.length > 1) throw new Error(`Multiple mods match "${name}" — use --mod-id`);
    modIds = [rows[0]!.id];
  } else {
    modIds = parseModIds(argv['mod-id']) ?? [];
  }

  const targets: ModTarget[] = [];
  for (const modId of modIds) {
    const { rows } = await db.query<{
      mod_id: number;
      mod_name: string;
      game: string;
      src_lang: string | null;
    }>(
      `SELECT m.id AS mod_id,
              m.name AS mod_name,
              COALESCE(m.game, mi.game, 'fo4') AS game,
              mi.src_lang
       FROM mods m
       LEFT JOIN LATERAL (
         SELECT game, src_lang
           FROM mod_imports
          WHERE mod_id = m.id AND status = 'completed'
          ORDER BY updated_at DESC
          LIMIT 1
       ) mi ON TRUE
       WHERE m.id = $1`,
      [modId],
    );
    const row = rows[0];
    if (!row) throw new Error(`Mod id=${modId} not found`);
    targets.push({
      modId: row.mod_id,
      modName: row.mod_name,
      game: row.game as GameType,
      srcLang: srcLangOverride ?? row.src_lang?.trim() ?? CONFIG.defaultSrcLang,
    });
  }
  return targets;
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

const logTranslateProgress = (
  ctx: { lastLogged: { done: number }; ok: number; errors: number; startedAt: number },
  event: CliTranslateProgressEvent,
): void => {
  if (event.type === 'started') {
    ctx.startedAt = Date.now();
    log.info(
      event.force
        ? `Translate (force): ${event.total} auto/draft string(s) to re-translate, db-chunk=${event.dbChunkSize}`
        : `Translate: ${event.total} untranslated string(s), db-chunk=${event.dbChunkSize}`,
    );
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

const runSkipPhase = async (target: ModTarget): Promise<'ok' | 'failed' | 'skipped'> => {
  const ctx = { lastLogged: { done: 0 }, candidates: 0, marked: 0 };
  try {
    const snapshot = await runLlmSkipDetectJob(
      db,
      {
        modId: target.modId,
        srcLang: target.srcLang,
        targetLang: tgtLang,
        modName: target.modName,
        game: target.game,
        useLlm,
        persist: true,
        force: skipForce,
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

const runTranslatePhase = async (target: ModTarget): Promise<'ok' | 'failed' | 'skipped'> => {
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
        force: skipForce,
      },
      (event) => logTranslateProgress(ctx, event),
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
    if (
      message.includes('No untranslated strings') ||
      message.includes('No translatable strings')
    ) {
      log.info(
        skipForce
          ? `Translate: nothing to do (mod_id=${target.modId}) — no auto/draft rows to re-translate`
          : `Translate: nothing to do (mod_id=${target.modId}) — all strings already translated or skipped`,
      );
      return 'skipped';
    }
    log.error(`Translate failed for mod_id=${target.modId}: ${message}`);
    return 'failed';
  }
};

const processMod = async (target: ModTarget): Promise<'ok' | 'failed'> => {
  const statsBefore = await loadModStats(target.modId, target.srcLang);
  log.info(
    `Processing mod_id=${target.modId} "${target.modName}" (src=${target.srcLang}, tgt=${tgtLang}, game=${target.game})`,
  );
  log.info(`Before: ${formatModStats(statsBefore)}`);

  if (!translateOnly) {
    const skipResult = await runSkipPhase(target);
    if (skipResult === 'failed') return 'failed';
    const afterSkip = await loadModStats(target.modId, target.srcLang);
    log.info(`After skip: ${formatModStats(afterSkip)}`);
  }

  if (!skipOnly) {
    const translateResult = await runTranslatePhase(target);
    if (translateResult === 'failed') return 'failed';
    const afterTranslate = await loadModStats(target.modId, target.srcLang);
    log.info(`After translate: ${formatModStats(afterTranslate)}`);
  }

  const statsAfter = await loadModStats(target.modId, target.srcLang);
  log.info(
    `Mod summary: skipped +${statsAfter.skipped - statsBefore.skipped}, ` +
      `translated +${statsAfter.translated - statsBefore.translated}, ` +
      `untranslated ${statsBefore.untranslated} → ${statsAfter.untranslated}`,
  );

  return 'ok';
};

try {
  const targets = await resolveModTargets();
  if (targets.length === 0) {
    log.warn('No mods found');
    process.exit(0);
  }

  log.info(
    `Auto-translate: ${targets.length} mod(s), skip=${!translateOnly}, translate=${!skipOnly}, ` +
      `useLlm=${useLlm}, skipForce=${skipForce}, dbChunk=${dbChunkSize}, llmRetries=${CONFIG.llmMaxAttempts}`,
  );

  let ok = 0;
  let failed = 0;

  for (const target of targets) {
    const result = await processMod(target);
    if (result === 'ok') ok++;
    else failed++;
  }

  log.info(`Auto-translate complete: ok=${ok}, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
} finally {
  await closeDb();
}
