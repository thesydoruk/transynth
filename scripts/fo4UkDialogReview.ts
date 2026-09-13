#!/usr/bin/env tsx
/**
 * Dry-run review of official FO4 INFO dialogues (base + DLC + cc*).
 * Calls OpenAI verify/translate and writes Markdown. Does not write translations.
 *
 *   node --import tsx/esm scripts/fo4UkDialogReview.ts --out-dir /review-out
 */
import '../src/loadEnv';
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, getTranslateModel, validateConfig } from '../src/config';
import { closeDb, openDb, type Tx } from '../src/db';
import { buildLlmParticipantPayload } from '../src/llm/dialogParticipants';
import { applyTranslateSplit, splitTranslateSource } from '../src/llm/textParts';
import { translateStrings, type LlmGlossaryEntry } from '../src/llm/translate';
import { verifyTranslationsWithLlm } from '../src/llm/verifyTranslate';
import { log } from '../src/logger';
import { FO4_UK_GLOSSARY } from '../src/resources/glossary/fo4-uk';
import { parseRecordLocation } from '../src/utils/recordLocation';
import { Semaphore } from '../src/utils/concurrency';
import { DIALOG_PROMPT_PATH, DIALOG_RESPONSE_PATH } from '../src/web/data/queries/dialogs/lines';
import { dialogParticipantsFromRow } from '../src/web/data/queries/dialogs/participants';

type DialogRow = {
  string_id: number;
  source: string;
  uk: string | null;
  path: string | null;
  formid_hex: string | null;
  edid: string | null;
  mod_id: number;
  mod_name: string;
  kind: 'prompt' | 'response';
  quest_edid: string | null;
  quest_name: string | null;
  scene_edid: string | null;
  timing_sensitive: boolean | null;
  speaker_key: string | null;
  speaker_name: string | null;
  speaker_gender: string | null;
  addressee_kind: string | null;
  addressee_name: string | null;
  addressee_gender: string | null;
};

type Proposal = {
  string_id: number;
  kind: 'prompt' | 'response';
  speaker: string;
  speaker_gender: string;
  addressee: string;
  quest_edid: string | null;
  quest_name: string | null;
  scene_edid: string | null;
  mod_name: string;
  source: string;
  current_uk: string | null;
  proposed_uk: string;
  reason: string;
  verdict: string;
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('fo4-uk-dialog-review')
  .option('out-dir', { type: 'string', demandOption: true, describe: 'Directory for MD/JSONL' })
  .option('batch-size', { type: 'number', default: CONFIG.batchSize })
  .option('parallel', { type: 'number', default: Math.max(2, CONFIG.llmMaxParallel) })
  .option('limit', { type: 'number', describe: 'Max lines (debug)' })
  .option('mod-id', { type: 'number', describe: 'Single official mod id' })
  .option('resume', { type: 'boolean', default: true })
  .help()
  .parse();

validateConfig();

const OUT_DIR = path.resolve(argv['out-dir']);
const JSONL_PATH = path.join(OUT_DIR, 'FO4-UK-dialogs.jsonl');
const MD_PATH = path.join(OUT_DIR, 'FO4-UK-dialogs.md');
const PROGRESS_PATH = path.join(OUT_DIR, 'FO4-UK-dialogs.progress.json');
const SRC_LANG = 'en';
const TARGET_LANG = 'uk';
const MODEL = getTranslateModel();

const LOAD_SQL = `
SELECT DISTINCT ON (s.id)
  s.id AS string_id,
  s.text_raw AS source,
  t.text AS uk,
  r.path,
  r.formid_hex,
  r.edid,
  m.id AS mod_id,
  m.name AS mod_name,
  CASE WHEN r.path_simplified = $1 THEN 'prompt' ELSE 'response' END AS kind,
  dq.edid AS quest_edid,
  dq.name AS quest_name,
  ds.edid AS scene_edid,
  ds.timing_sensitive,
  dn.speaker_key,
  nsp.display_name AS speaker_name,
  COALESCE(nsp.gender_override, CASE WHEN nsp.is_player THEN 'any' END,
           nsp.detected_gender, 'unknown') AS speaker_gender,
  dn.addressee_kind,
  nad.display_name AS addressee_name,
  COALESCE(nad.gender_override, CASE WHEN nad.is_player THEN 'any' END,
           nad.detected_gender, 'unknown') AS addressee_gender
FROM strings s
JOIN records r ON r.id = s.record_id
JOIN mods m ON m.id = r.mod_id
LEFT JOIN translations t ON t.src_string_id = s.id AND t.target_lang = $2
LEFT JOIN dialog_nodes dn ON dn.info_formid_hex = r.formid_hex
LEFT JOIN dialog_topics dt ON dt.id = dn.topic_id AND dt.mod_id = r.mod_id
LEFT JOIN dialog_quests dq ON dq.mod_id = dt.mod_id AND dq.formid_hex = dt.quest_formid_hex
LEFT JOIN dialog_scene_phases dsp ON dsp.topic_id = dt.id
LEFT JOIN dialog_scenes ds ON ds.id = dsp.scene_id AND ds.mod_id = r.mod_id
LEFT JOIN dialog_speakers nsp ON nsp.mod_id = dt.mod_id AND nsp.speaker_key = dn.speaker_key
LEFT JOIN dialog_speakers nad ON nad.mod_id = dt.mod_id AND nad.speaker_key = dn.addressee_speaker_key
WHERE s.lang = $3
  AND m.game = 'fo4'
  AND (
    m.name ILIKE 'Fallout4%'
    OR m.name ILIKE 'DLC%'
    OR m.name ILIKE 'cc%'
  )
  AND r.signature = 'INFO'
  AND r.path_simplified IN ($1, $4)
  AND btrim(s.text_raw) <> ''
  AND ($5::int IS NULL OR m.id = $5)
ORDER BY s.id, ds.id NULLS LAST
`;

const glossaryFor = (sources: string[]): LlmGlossaryEntry[] => {
  const hay = sources.join('\n').toLowerCase();
  return FO4_UK_GLOSSARY.filter((entry) => hay.includes(entry.term.toLowerCase())).map((entry) => ({
    term: entry.term,
    translation: entry.translation,
  }));
};

const chunkByQuest = (rows: DialogRow[], size: number): DialogRow[][] => {
  const chunks: DialogRow[][] = [];
  let current: DialogRow[] = [];
  let quest = rows[0]?.quest_edid ?? null;
  for (const row of rows) {
    const nextQuest = row.quest_edid ?? null;
    const overflow = current.length >= size;
    const questBreak =
      current.length > 0 && nextQuest !== quest && current.length >= Math.min(8, size);
    if (overflow || questBreak) {
      chunks.push(current);
      current = [];
    }
    current.push(row);
    quest = nextQuest;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
};

const loadDoneIds = (): Set<number> => {
  const done = new Set<number>();
  if (!argv.resume || !fs.existsSync(JSONL_PATH)) return done;
  for (const line of fs.readFileSync(JSONL_PATH, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { string_id?: number; skipped_ids?: number[] };
      if (typeof row.string_id === 'number') done.add(row.string_id);
      if (Array.isArray(row.skipped_ids)) {
        for (const id of row.skipped_ids) if (typeof id === 'number') done.add(id);
      }
    } catch {
      /* ignore broken tail */
    }
  }
  return done;
};

const appendJsonl = (value: unknown): void => {
  fs.appendFileSync(JSONL_PATH, `${JSON.stringify(value)}\n`, 'utf8');
};

const speakerLabel = (row: DialogRow): { speaker: string; gender: string; addressee: string } => {
  const field = parseRecordLocation('INFO', row.path).field;
  const participants = dialogParticipantsFromRow(row, field);
  if (row.kind === 'prompt') {
    return {
      speaker: 'гравець',
      gender: participants.speakerGender,
      addressee: participants.addresseeName ?? row.speaker_name ?? 'NPC',
    };
  }
  return {
    speaker: participants.speakerName ?? row.speaker_name ?? 'NPC',
    gender: participants.speakerGender,
    addressee:
      row.addressee_kind === 'player' || participants.addresseeName === 'Player'
        ? 'гравець'
        : (participants.addresseeName ?? row.addressee_name ?? 'гравець'),
  };
};

const toVerifyItem = (row: DialogRow) => {
  const { grup, field } = parseRecordLocation('INFO', row.path);
  const participants = dialogParticipantsFromRow(row, field);
  return {
    id: row.string_id,
    source: row.source,
    translation: row.uk ?? '',
    grup,
    edid: row.edid,
    field,
    form_id: row.formid_hex,
    context:
      [
        row.quest_edid && `quest=${row.quest_edid}`,
        row.scene_edid && `scene=${row.scene_edid}`,
        row.timing_sensitive && 'timing_sensitive',
        row.kind === 'prompt' && 'kind=prompt',
      ]
        .filter(Boolean)
        .join('; ') || null,
    ...buildLlmParticipantPayload(participants),
  };
};

const toTranslateItem = (row: DialogRow) => {
  const item = toVerifyItem(row);
  const { translation: _uk, ...rest } = item;
  return applyTranslateSplit(
    rest,
    splitTranslateSource(row.source, 'fo4', { grup: rest.grup, field: rest.field }),
  );
};

const renderMd = (proposals: Proposal[], stats: Record<string, unknown>): string => {
  const byMod = new Map<string, Proposal[]>();
  for (const row of proposals) {
    const list = byMod.get(row.mod_name) ?? [];
    list.push(row);
    byMod.set(row.mod_name, list);
  }
  const lines = [
    '# FO4 UK діалоги — пропозиції (не залито)',
    '',
    `Згенеровано: ${new Date().toISOString()}`,
    `Провайдер: ${CONFIG.llmProvider} · модель: ${MODEL}`,
    'Охоплення: офіційні INFO (`NAM1` + `RNAM`) модів Fallout4 / DLC* / cc*. Vortex-завантаження не входять.',
    'У базу **не** записано. Заливка — лише після рев’ю через `fo4-uk-apply`.',
    '',
    '## Підсумок',
    '',
    '```json',
    JSON.stringify(stats, null, 2),
    '```',
    '',
  ];
  for (const [modName, rows] of [...byMod.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`## ${modName}`, '');
    let quest = '';
    for (const row of rows) {
      const questKey = `${row.quest_edid ?? '—'} · ${row.quest_name ?? ''}`;
      if (questKey !== quest) {
        quest = questKey;
        lines.push(`### Квест ${row.quest_edid ?? '—'} · ${row.quest_name ?? ''}`, '');
      }
      lines.push(
        `#### ${row.string_id} · ${row.kind} · ${row.speaker} (${row.speaker_gender}) → ${row.addressee}`,
        `квест ${row.quest_edid ?? '—'} · сцена ${row.scene_edid ?? '—'} · ${row.mod_name}`,
        `EN: ${row.source}`,
        `UK зараз: ${row.current_uk ?? '—'}`,
        `UK: ${row.proposed_uk}`,
        `навіщо: ${row.reason}`,
        '',
      );
    }
  }
  return `${lines.join('\n')}\n`;
};

const writeOutputs = (proposals: Proposal[], stats: Record<string, unknown>): void => {
  fs.writeFileSync(MD_PATH, renderMd(proposals, stats), 'utf8');
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(stats, null, 2), 'utf8');
};

const loadRows = async (db: Tx): Promise<DialogRow[]> => {
  const { rows } = await db.query<DialogRow>(LOAD_SQL, [
    DIALOG_PROMPT_PATH,
    TARGET_LANG,
    SRC_LANG,
    DIALOG_RESPONSE_PATH,
    argv['mod-id'] ?? null,
  ]);
  rows.sort((a, b) => {
    const mod = a.mod_name.localeCompare(b.mod_name);
    if (mod !== 0) return mod;
    const quest = (a.quest_edid ?? '').localeCompare(b.quest_edid ?? '');
    if (quest !== 0) return quest;
    const scene = (a.scene_edid ?? '').localeCompare(b.scene_edid ?? '');
    if (scene !== 0) return scene;
    return a.string_id - b.string_id;
  });
  return argv.limit ? rows.slice(0, argv.limit) : rows;
};

const processChunk = async (chunk: DialogRow[]): Promise<{ proposals: Proposal[]; ok: number }> => {
  const missing = chunk.filter((row) => !row.uk?.trim());
  const existing = chunk.filter((row) => Boolean(row.uk?.trim()));
  const proposals: Proposal[] = [];
  let ok = 0;
  const glossary = glossaryFor(chunk.map((row) => row.source));

  if (missing.length > 0) {
    const translated = await translateStrings({
      items: missing.map(toTranslateItem),
      model: MODEL,
      srcLang: SRC_LANG,
      targetLang: TARGET_LANG,
      game: 'fo4',
      promptFamily: 'dialog',
      modName: missing[0]?.mod_name,
      glossary,
    });
    const byId = new Map(translated.map((row) => [row.id, row.translation]));
    for (const row of missing) {
      const proposed = byId.get(row.string_id);
      if (!proposed) continue;
      const who = speakerLabel(row);
      proposals.push({
        string_id: row.string_id,
        kind: row.kind,
        speaker: who.speaker,
        speaker_gender: who.gender,
        addressee: who.addressee,
        quest_edid: row.quest_edid,
        quest_name: row.quest_name,
        scene_edid: row.scene_edid,
        mod_name: row.mod_name,
        source: row.source,
        current_uk: null,
        proposed_uk: proposed,
        reason: 'Немає UK — адаптований переклад з контекстом сцени/квесту.',
        verdict: 'missing',
      });
    }
  }

  if (existing.length > 0) {
    const results = await verifyTranslationsWithLlm({
      items: existing.map(toVerifyItem),
      model: MODEL,
      srcLang: SRC_LANG,
      targetLang: TARGET_LANG,
      game: 'fo4',
      promptFamily: 'dialog',
      modName: existing[0]?.mod_name,
      glossary,
    });
    const rewrite = results.filter((row) => row.verdict === 'incorrect' && !row.suggestion?.trim());
    const rewritten = new Map<number, string>();
    if (rewrite.length > 0) {
      const sourceRows = existing.filter((row) =>
        rewrite.some((item) => item.id === row.string_id),
      );
      const translated = await translateStrings({
        items: sourceRows.map(toTranslateItem),
        model: MODEL,
        srcLang: SRC_LANG,
        targetLang: TARGET_LANG,
        game: 'fo4',
        promptFamily: 'dialog',
        modName: sourceRows[0]?.mod_name,
        glossary,
      });
      for (const row of translated) rewritten.set(row.id, row.translation);
    }
    for (const result of results) {
      const row = existing.find((item) => item.string_id === result.id);
      if (!row) continue;
      if (result.verdict === 'ok') {
        ok += 1;
        continue;
      }
      const proposed = result.suggestion?.trim() || rewritten.get(result.id);
      if (!proposed || proposed === row.uk) {
        ok += 1;
        continue;
      }
      const who = speakerLabel(row);
      proposals.push({
        string_id: row.string_id,
        kind: row.kind,
        speaker: who.speaker,
        speaker_gender: who.gender,
        addressee: who.addressee,
        quest_edid: row.quest_edid,
        quest_name: row.quest_name,
        scene_edid: row.scene_edid,
        mod_name: row.mod_name,
        source: row.source,
        current_uk: row.uk,
        proposed_uk: proposed,
        reason: result.reason,
        verdict: result.verdict,
      });
    }
  }

  return { proposals, ok };
};

const db = openDb();
fs.mkdirSync(OUT_DIR, { recursive: true });
if (!argv.resume) {
  for (const file of [JSONL_PATH, MD_PATH, PROGRESS_PATH]) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

const proposals: Proposal[] = [];
if (fs.existsSync(JSONL_PATH)) {
  for (const line of fs.readFileSync(JSONL_PATH, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as Proposal & { skipped_ids?: number[] };
      if (typeof row.string_id === 'number' && row.proposed_uk) proposals.push(row);
    } catch {
      /* ignore */
    }
  }
}

try {
  const rows = await loadRows(db);
  const done = loadDoneIds();
  const pending = rows.filter((row) => !done.has(row.string_id));
  const chunks = chunkByQuest(pending, Math.max(4, argv['batch-size']));
  const stats = {
    provider: CONFIG.llmProvider,
    model: MODEL,
    total: rows.length,
    already_done: done.size,
    pending: pending.length,
    ok: 0,
    changed: proposals.length,
    errors: 0,
    chunks: chunks.length,
  };
  log.info(
    `FO4 UK dialog review: ${rows.length} lines, ${pending.length} pending, ${chunks.length} chunks, model=${MODEL}`,
  );
  writeOutputs(proposals, stats);

  const pool = new Semaphore(Math.max(1, argv.parallel));
  let finished = 0;
  await Promise.all(
    chunks.map((chunk) =>
      pool.run(async () => {
        try {
          const result = await processChunk(chunk);
          stats.ok += result.ok;
          for (const proposal of result.proposals) {
            proposals.push(proposal);
            appendJsonl(proposal);
          }
          const skipped = chunk
            .map((row) => row.string_id)
            .filter((id) => !result.proposals.some((row) => row.string_id === id));
          if (skipped.length > 0) appendJsonl({ skipped_ids: skipped });
          stats.changed = proposals.length;
        } catch (err) {
          stats.errors += chunk.length;
          log.warn('chunk failed', {
            ids: chunk.map((row) => row.string_id),
            error: err instanceof Error ? err.message : String(err),
          });
        } finally {
          finished += 1;
          if (finished % 5 === 0 || finished === chunks.length) {
            writeOutputs(proposals, { ...stats, chunks_done: finished });
            log.info(
              `progress ${finished}/${chunks.length} chunks, changed=${proposals.length}, ok=${stats.ok}, errors=${stats.errors}`,
            );
          }
        }
      }),
    ),
  );

  writeOutputs(proposals, { ...stats, chunks_done: chunks.length, done: true });
  log.info(`Wrote ${proposals.length} proposals to ${MD_PATH}`);
} finally {
  await closeDb();
}
