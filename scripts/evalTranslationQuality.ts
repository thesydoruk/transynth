/**
 * Score a mod's stored translations against the machine-checkable defects, so
 * a prompt or pipeline change can be shown to have helped.
 *
 * Reads straight from the database — the translations are already there, and a
 * separate corpus file would drift from them.
 *
 *   npm run eval:quality -- --mod 33
 *   npm run eval:quality -- --mod 33 --status reviewed --out data/eval/fo4.json
 *   npm run eval:quality -- --mod 33 --baseline data/eval/fo4.json
 *
 * `--out` writes the report so a later run can `--baseline` against it and
 * print the change per bucket. Nothing is written to the database.
 */
// Registers the game plugins; the registry lookups below depend on it.
import '../src/games';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../src/db';
import {
  buildEvalReport,
  formatEvalReport,
  type EvalLine,
  type EvalReport,
} from '../src/llm/eval/qualityReport';
import {
  DIALOG_PARTICIPANT_COLUMNS,
  dialogParticipantsFromRow,
  dialogParticipantsLateralSql,
  type DialogParticipantsRow,
} from '../src/web/data/queries/dialogs';
import { parseRecordLocation } from '../src/utils/recordLocation';

type Args = {
  modId: number | null;
  targetLang: string;
  status: string | null;
  limit: number;
  out: string | null;
  baseline: string | null;
  showFailures: number;
};

const parseArgs = (argv: string[]): Args => {
  const get = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? (argv[index + 1] ?? null) : null;
  };
  return {
    modId: get('mod') ? Number(get('mod')) : null,
    targetLang: get('lang') ?? 'uk',
    status: get('status'),
    limit: Number(get('limit') ?? 200000),
    out: get('out'),
    baseline: get('baseline'),
    showFailures: Number(get('show') ?? 15),
  };
};

type Row = DialogParticipantsRow & {
  string_id: number;
  source: string;
  translation: string;
  signature: string | null;
  path: string | null;
  game: string | null;
};

const loadLines = async (args: Args): Promise<EvalLine[]> => {
  const db = openDb();
  const params: unknown[] = [args.targetLang, args.limit];
  const filters = [`t.target_lang = $1`, `s.is_ignored = FALSE`, `length(trim(t.text)) > 0`];

  if (args.modId != null) {
    params.push(args.modId);
    filters.push(`r.mod_id = $${params.length}`);
  }
  if (args.status) {
    params.push(args.status);
    filters.push(`t.status = $${params.length}`);
  }

  const { rows } = await db.query<Row>(
    `SELECT s.id AS string_id,
            s.text_raw AS source,
            t.text AS translation,
            r.signature,
            r.path,
            m.game,
            ${DIALOG_PARTICIPANT_COLUMNS}
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN mods m ON m.id = r.mod_id
       JOIN translations t ON t.src_string_id = s.id
       LEFT JOIN LATERAL (${dialogParticipantsLateralSql('r')}) dp ON TRUE
      WHERE ${filters.join(' AND ')}
      ORDER BY s.id
      LIMIT $2`,
    params,
  );

  return rows.map((row) => {
    const { grup, field } = parseRecordLocation(row.signature, row.path);
    const participants = dialogParticipantsFromRow(row, field, row.game);
    return {
      id: row.string_id,
      source: row.source,
      translation: row.translation,
      grup,
      field,
      speakerGender: participants.speakerGender,
      addresseeGender: participants.addresseeGender,
      game: row.game,
    };
  });
};

const readBaseline = (file: string): EvalReport | undefined => {
  if (!fs.existsSync(file)) {
    console.warn(`baseline ${file} not found; reporting absolute numbers only`);
    return undefined;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as EvalReport;
};

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2));
  const lines = await loadLines(args);

  if (lines.length === 0) {
    console.error('No translations matched. Check --mod / --lang / --status.');
    process.exitCode = 1;
    return;
  }

  const report = buildEvalReport(lines);
  console.log(formatEvalReport(report, args.baseline ? readBaseline(args.baseline) : undefined));

  if (args.showFailures > 0 && report.defects.length > 0) {
    const byId = new Map(lines.map((line) => [line.id, line]));
    console.log('\nexamples:');
    for (const defect of report.defects.slice(0, args.showFailures)) {
      const line = byId.get(defect.id);
      console.log(`  [${defect.kind}] ${defect.detail}`);
      console.log(`    EN: ${line?.source.slice(0, 120)}`);
      console.log(`    UK: ${line?.translation.slice(0, 120)}`);
    }
  }

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    // Defect lists get long; the buckets are what a later run compares against.
    fs.writeFileSync(args.out, JSON.stringify({ ...report, defects: [] }, null, 2), 'utf8');
    console.log(`\nreport written to ${args.out}`);
  }
};

await main();
