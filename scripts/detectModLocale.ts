#!/usr/bin/env tsx
/**
 * Audit whether a mod was imported with the correct source locale (LLM sample check).
 *
 * Detects non-localized mods that ship embedded translations (e.g. Russian text
 * stored as English source). Detection only — no automatic fixes.
 *
 * Mod selector (exactly one required):
 *   --mod-id <id>       Database mod id to audit
 *   --mod-name <name>   Exact mod name (must be unique)
 *   --all               Every mod with a completed import job
 *
 * Usage:
 *   npm run detect:locale -- [options]
 *
 * Options:
 *   --import-id <id>    Specific mod_imports job id (default: latest for mod)
 *   --sample <n>        Random string sample size for the LLM (default: service default)
 *   --json              Print machine-readable JSON report to stdout
 *
 * Examples:
 *   npm run detect:locale -- --mod-id 45
 *   npm run detect:locale -- --mod-name "MyMod.esp"
 *   npm run detect:locale -- --all --sample 50
 *   npm run detect:locale -- --mod-id 45 --import-id 12 --json
 */
import '../src/loadEnv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { validateConfig } from '../src/config';
import { openDb, closeDb } from '../src/db';
import { log } from '../src/logger';
import {
  auditModLocale,
  formatLocaleAuditHint,
  listModLocaleAuditTargets,
  LOCALE_DETECT_DEFAULT_SAMPLES,
  LOCALE_DETECT_MAX_SAMPLES,
  type ModLocaleAuditReport,
} from '../src/web/modLocaleDetect';

const argv = await yargs(hideBin(process.argv))
  .scriptName('detect:locale')
  .usage('$0 [options]')
  .option('mod-id', {
    type: 'number',
    describe: 'Database mod id to audit',
  })
  .option('mod-name', {
    type: 'string',
    describe: 'Exact mod name (must be unique)',
  })
  .option('import-id', {
    type: 'number',
    describe: 'Specific mod_imports job id (default: latest for mod)',
  })
  .option('all', {
    type: 'boolean',
    default: false,
    describe: 'Audit all mods with completed import jobs',
  })
  .option('sample', {
    type: 'number',
    default: LOCALE_DETECT_DEFAULT_SAMPLES,
    describe: `Random string sample size for the LLM (1–${LOCALE_DETECT_MAX_SAMPLES})`,
  })
  .option('json', {
    type: 'boolean',
    default: false,
    describe: 'Print machine-readable JSON report to stdout',
  })
  .check((args) => {
    const hasTarget = args.all || args['mod-id'] != null || args['mod-name'];
    if (!hasTarget) {
      throw new Error('Specify --mod-id, --mod-name, or --all');
    }
    if (args.all && (args['mod-id'] != null || args['mod-name'])) {
      throw new Error('Use either --all or a single-mod selector, not both');
    }
    return true;
  })
  .help()
  .parse();

validateConfig();

const sampleSize = Math.max(1, Math.min(LOCALE_DETECT_MAX_SAMPLES, argv.sample));
const db = openDb();

const printHumanReport = (report: ModLocaleAuditReport): void => {
  const hint = formatLocaleAuditHint(report);
  const flag = hint ? '⚠' : '✓';
  log.info(
    `${flag} mod_id=${report.modId} "${report.modName}" — verdict=${report.llm.verdict}, ` +
      `detected=${report.llm.overall_detected_language} (conf=${report.llm.overall_confidence.toFixed(2)}), ` +
      `expected=${report.expectedLang.trim().toLowerCase()}, stored_lang=${report.storedLang}, ` +
      `localized=${report.isLocalized}, samples=${report.sampleSize}/${report.stringCount}`,
  );
  if (report.fileName) {
    log.info(
      `  import: job #${report.importJobId ?? '?'} file="${report.fileName}" status=${report.importStatus ?? 'n/a'}`,
    );
  }
  log.info(`  ${report.llm.summary}`);
  if (hint) log.warn(`  ${hint}`);
};

try {
  if (argv.all) {
    const targets = await listModLocaleAuditTargets(db, 'completed');
    if (targets.length === 0) {
      log.warn('No completed mod imports found');
      process.exit(0);
    }

    log.info(`Auditing ${targets.length} mod(s), sample=${sampleSize} strings each`);
    const reports: ModLocaleAuditReport[] = [];

    for (const target of targets) {
      try {
        const report = await auditModLocale(db, {
          modId: target.modId,
          sampleSize,
        });
        reports.push(report);
        if (!argv.json) printHumanReport(report);
      } catch (err) {
        log.error(
          `Failed mod_id=${target.modId} "${target.modName}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (argv.json) {
      console.log(JSON.stringify({ reports }, null, 2));
    } else {
      const issues = reports.filter((r) => formatLocaleAuditHint(r) != null);
      log.info(`Done: ${reports.length} audited, ${issues.length} with possible locale mismatch`);
    }
  } else {
    const report = await auditModLocale(db, {
      modId: argv['mod-id'],
      modName: argv['mod-name'],
      importId: argv['import-id'],
      sampleSize,
    });

    if (argv.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHumanReport(report);
    }
  }
} finally {
  await closeDb();
}
