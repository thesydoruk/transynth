#!/usr/bin/env tsx
/**
 * Automatic AI translation review: verify pending rows, auto-approve OK, auto-fix incorrect rows.
 *
 * By default only draft/tm/fuzzy/auto translations are checked. Use `--force` to re-check
 * confirmed (reviewed/human) rows as well.
 *
 * Mod selector (exactly one required):
 *   --mod-id <ids>      Comma-separated database mod ids
 *   --mod-name <name>   Exact mod name (must be unique)
 *   --all               Every mod with a completed import job
 *
 * Usage:
 *   npm run verify:auto -- [options]
 *
 * Options:
 *   --src-lang <code>   Source language override (default: per-mod import or SRC_LANG)
 *   --tgt-lang <code>   Target language to verify (default: TGT_LANG)
 *   --dry-run           Log issues only; do not approve or apply fixes
 *   --no-auto-approve   Do not promote passing rows to reviewed
 *   --fix-suspicious    Also apply LLM suggestions for suspicious rows (not only incorrect)
 *   --force             Also verify confirmed translations (reviewed/human)
 *   --db-chunk <n>      DB page size for large mods (default: service default)
 *   --no-rag            Disable reference-example search
 *   --rag-mod-only      Search reference examples only within the current mod
 *
 * Examples:
 *   npm run verify:auto -- --mod-id 45
 *   npm run verify:auto -- --mod-name "MyMod.esp"
 *   npm run verify:auto -- --all
 *   npm run verify:auto -- --mod-id 45 --dry-run
 *   npm run verify:auto -- --mod-id 45 --fix-suspicious --force
 *   npm run verify:auto -- --mod-id 45 --tgt-lang uk --no-rag
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import { formatLogBlock } from '../src/logging/format';
import { LLM_VERIFY_DB_CHUNK_SIZE } from '../src/web/llmVerifyService';
import { runCliModVerify, type CliVerifyProgressEvent } from '../src/web/cliAutoVerify';
import type { LlmVerifyIssue } from '../src/web/llmVerifyService';
import { formatVerifyIssuePrefix, resolveVerifyFixAction } from '../src/llm/verifySuggestionGuards';
import { parseRecordLocation } from '../src/utils/recordLocation';
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

const formatIssueLocation = (issue: LlmVerifyIssue): string =>
  issue.edid ?? issue.path ?? issue.signature ?? '—';

const logIssue = (
  issue: LlmVerifyIssue,
  dryRun: boolean,
  fixSuspicious: boolean,
  game: string | null | undefined,
  opts?: { separator?: boolean },
): void => {
  const loc = formatIssueLocation(issue);
  const { grup, field } = parseRecordLocation(issue.signature, issue.path);
  const fixAction = resolveVerifyFixAction(
    {
      id: issue.stringId,
      source: issue.source,
      translation: issue.translation,
      grup,
      edid: issue.edid,
      field,
      context: null,
    },
    issue.verdict,
    issue.suggestion,
    fixSuspicious,
    game,
  );
  const prefix = formatVerifyIssuePrefix(dryRun, fixAction);
  const block = formatLogBlock(
    `${prefix} [${issue.verdict}] string_id=${issue.stringId} ${loc} (conf=${issue.confidence.toFixed(2)})`,
    {
      reason: issue.reason,
      was: issue.translation,
      ...(issue.suggestion ? { fix: issue.suggestion } : {}),
      ...(fixAction.kind === 'reject_fix' ? { fixRejected: fixAction.message } : {}),
    },
  );
  log.info(opts?.separator ? `\n${block}` : block);
};

const argv = await addCliRagFlagOptions(
  yargs(hideBin(process.argv))
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
    .option('force', {
      type: 'boolean',
      default: false,
      describe: 'Also verify confirmed translations (reviewed/human), not only pending rows',
    })
    .option('db-chunk', {
      type: 'number',
      describe: `DB page size for large mods (default: ${LLM_VERIFY_DB_CHUNK_SIZE})`,
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

const ragFlags = readCliRagFlags(argv);

const tgtLang = argv['tgt-lang'].trim();
const dryRun = argv['dry-run'];
const autoApproveVerified = !argv['no-auto-approve'];
const fixSuspicious = argv['fix-suspicious'];
const force = argv.force;
const dbChunkSize =
  argv['db-chunk'] != null ? Math.max(50, argv['db-chunk']) : LLM_VERIFY_DB_CHUNK_SIZE;

const db = openDb();

const logVerifyProgress = (
  ctx: {
    lastLogged: { done: number };
    dryRun: boolean;
    fixSuspicious: boolean;
    game: string | null;
    startedAt: number;
    issueCount: number;
  },
  event: CliVerifyProgressEvent,
): void => {
  if (event.type === 'started') {
    const scope = force ? 'eligible' : 'pending';
    log.info(
      `Verify${force ? ' (force)' : ''}: ${event.total} ${scope} row(s), dryRun=${event.dryRun}, db-chunk=${event.dbChunkSize}`,
    );
    return;
  }
  if (event.type === 'progress') {
    if (event.issue) {
      logIssue(event.issue, ctx.dryRun, ctx.fixSuspicious, ctx.game, {
        separator: ctx.issueCount > 0,
      });
      ctx.issueCount++;
    }
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

const processMod = async (target: CliModTarget): Promise<'ok' | 'failed' | 'skipped'> => {
  log.info(
    `Processing mod_id=${target.modId} "${target.modName}" (src=${target.srcLang}, tgt=${tgtLang}, game=${target.game})`,
  );

  const ctx = {
    lastLogged: { done: 0 },
    dryRun,
    fixSuspicious,
    game: target.game,
    startedAt: Date.now(),
    issueCount: 0,
  };
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
        force,
        dbChunkSize,
        rag: toRagRetrievalOptions(ragFlags, target.modId),
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
      log.info(
        force
          ? `Verify: nothing to do (mod_id=${target.modId}) — no eligible rows`
          : `Verify: nothing to do (mod_id=${target.modId}) — no pending rows`,
      );
      return 'skipped';
    }
    log.error(`Verify failed for mod_id=${target.modId}: ${message}`);
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
    `Auto-verify: ${targets.length} mod(s), dryRun=${dryRun}, force=${force}, autoApprove=${!dryRun && autoApproveVerified}, ` +
      `fixSuspicious=${fixSuspicious}, ${formatCliRagFlags(ragFlags)}, dbChunk=${dbChunkSize}, llmRetries=${CONFIG.llmMaxAttempts}`,
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
