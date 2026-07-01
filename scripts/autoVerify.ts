#!/usr/bin/env tsx
/**
 * Automatic AI translation review: verify pending rows, auto-approve OK, auto-fix incorrect rows.
 *
 * Usage:
 *   npm run verify:auto -- --mod-id 45
 *   npm run verify:auto -- --mod-name "MyMod.esp"
 *   npm run verify:auto -- --all
 *   npm run verify:auto -- --mod-id 45 --dry-run
 *   npm run verify:auto -- --mod-id 45 --fix-suspicious
 *   npm run verify:auto -- --mod-id 45 --tgt-lang uk
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import type { GameType } from '../src/types';
import { LLM_VERIFY_DB_CHUNK_SIZE } from '../src/web/llmVerifyService';
import { runCliModVerify, type CliVerifyProgressEvent } from '../src/web/cliAutoVerify';
import type { LlmVerifyIssue } from '../src/web/llmVerifyService';

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

const formatPct = (done: number, total: number): string => {
  if (total <= 0) return '0%';
  return `${Math.round((done / total) * 100)}%`;
};

const formatIssueLocation = (issue: LlmVerifyIssue): string =>
  issue.edid ?? issue.path ?? issue.signature ?? '—';

const wouldApplySuggestion = (issue: LlmVerifyIssue, fixSuspicious: boolean): boolean => {
  if (!issue.suggestion) return false;
  if (issue.verdict === 'incorrect') return true;
  return issue.verdict === 'suspicious' && fixSuspicious;
};

const logIssue = (issue: LlmVerifyIssue, dryRun: boolean, fixSuspicious: boolean): void => {
  const loc = formatIssueLocation(issue);
  const suggestion = issue.suggestion ? ` | suggestion: ${issue.suggestion}` : '';
  const willFix = wouldApplySuggestion(issue, fixSuspicious);
  const prefix = dryRun ? (willFix ? 'Would fix' : 'Would flag') : willFix ? 'Fixed' : 'Flagged';
  log.info(
    `${prefix} [${issue.verdict}] string_id=${issue.stringId} ${loc} (conf=${issue.confidence.toFixed(2)}): ${issue.reason} | current: ${issue.translation}${suggestion}`,
  );
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('verify:auto')
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
  .option('dry-run', {
    type: 'boolean',
    default: false,
    describe: 'Only log suspicious/incorrect rows; do not approve or apply fixes',
  })
  .option('no-auto-approve', {
    type: 'boolean',
    default: false,
    describe:
      'Do not promote passing rows to reviewed (still auto-fixes incorrect rows unless --dry-run)',
  })
  .option('fix-suspicious', {
    type: 'boolean',
    default: false,
    describe:
      'Also apply LLM suggestions for suspicious rows (default: only incorrect rows are auto-fixed)',
  })
  .option('db-chunk', {
    type: 'number',
    describe: `DB page size for large mods (default: ${LLM_VERIFY_DB_CHUNK_SIZE})`,
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
    return true;
  })
  .help()
  .parse();

validateConfig();

const tgtLang = argv['tgt-lang'].trim();
const srcLangOverride = argv['src-lang']?.trim() || undefined;
const dryRun = argv['dry-run'];
const autoApproveVerified = !argv['no-auto-approve'];
const fixSuspicious = argv['fix-suspicious'];
const dbChunkSize =
  argv['db-chunk'] != null ? Math.max(50, argv['db-chunk']) : LLM_VERIFY_DB_CHUNK_SIZE;

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

const logVerifyProgress = (
  ctx: { lastLogged: { done: number }; dryRun: boolean; fixSuspicious: boolean; startedAt: number },
  event: CliVerifyProgressEvent,
): void => {
  if (event.type === 'started') {
    log.info(
      `Verify: ${event.total} pending row(s), dryRun=${event.dryRun}, db-chunk=${event.dbChunkSize}`,
    );
    return;
  }
  if (event.type === 'progress') {
    if (event.issue) logIssue(event.issue, ctx.dryRun, ctx.fixSuspicious);
    if (event.chunkError) {
      log.warn(
        `Verify chunk error string_id=${event.chunkError.stringIds.join(',')}: ${event.chunkError.message}`,
      );
    }
    const step = event.total >= 500 ? 100 : event.total >= 100 ? 50 : 25;
    if (event.done === event.total || event.done - ctx.lastLogged.done >= step) {
      ctx.lastLogged.done = event.done;
      const elapsedSec = Math.max(1, Math.round((Date.now() - ctx.startedAt) / 1000));
      const rate = (event.done / elapsedSec).toFixed(1);
      log.info(
        `Verify: ${event.done}/${event.total} (${formatPct(event.done, event.total)}), ` +
          `approved=${event.approved}, fixed=${event.fixed}, ` +
          `suspicious=${event.suspicious}, incorrect=${event.incorrect}, errors=${event.errors}, ` +
          `page=${event.dbPage}, ~${rate}/s`,
      );
    }
    return;
  }
  if (event.type === 'done') {
    log.info(
      `Verify done: ${event.done}/${event.total} (${formatPct(event.done, event.total)}), ` +
        `approved=${event.approved}, fixed=${event.fixed}, ` +
        `suspicious=${event.suspicious}, incorrect=${event.incorrect}, errors=${event.errors}`,
    );
    return;
  }
  if (event.type === 'error') {
    log.error(`Verify error: ${event.error}`);
  }
};

const processMod = async (target: ModTarget): Promise<'ok' | 'failed' | 'skipped'> => {
  log.info(
    `Processing mod_id=${target.modId} "${target.modName}" (src=${target.srcLang}, tgt=${tgtLang}, game=${target.game})`,
  );

  const ctx = { lastLogged: { done: 0 }, dryRun, fixSuspicious, startedAt: Date.now() };
  try {
    const summary = await runCliModVerify(
      db,
      {
        modId: target.modId,
        srcLang: target.srcLang,
        targetLang: tgtLang,
        modName: target.modName,
        game: target.game,
        dryRun,
        autoApproveVerified,
        fixSuspicious,
        dbChunkSize,
      },
      (event) => logVerifyProgress(ctx, event),
    );

    if (summary.errors > 0 && summary.approved === 0 && summary.fixed === 0) {
      log.error(`Verify failed for mod_id=${target.modId}: all ${summary.errors} row(s) errored`);
      return 'failed';
    }
    if (summary.errors > 0) {
      log.warn(`Verify finished with ${summary.errors} error(s) (mod_id=${target.modId})`);
    }
    return 'ok';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('No strings pending review')) {
      log.info(`Verify: nothing to do (mod_id=${target.modId}) — no pending rows`);
      return 'skipped';
    }
    log.error(`Verify failed for mod_id=${target.modId}: ${message}`);
    return 'failed';
  }
};

try {
  const targets = await resolveModTargets();
  if (targets.length === 0) {
    log.warn('No mods found');
    process.exit(0);
  }

  log.info(
    `Auto-verify: ${targets.length} mod(s), dryRun=${dryRun}, autoApprove=${!dryRun && autoApproveVerified}, ` +
      `fixSuspicious=${!dryRun && fixSuspicious}, dbChunk=${dbChunkSize}, llmRetries=${CONFIG.llmMaxAttempts}`,
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

  log.info(`Auto-verify complete: ok=${ok}, skipped=${skipped}, failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
} finally {
  await closeDb();
}
