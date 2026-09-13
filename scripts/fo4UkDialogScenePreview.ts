#!/usr/bin/env tsx
/**
 * Dry-run: translate a few official FO4 scenes via the same LLM helpers the
 * worker uses. Writes a Markdown report. Does not upsert translations.
 *
 *   node --import tsx/esm scripts/fo4UkDialogScenePreview.ts --out FO4-UK-dialogs.md
 */
import '../src/loadEnv';
import fs from 'node:fs';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { CONFIG, validateConfig } from '../src/config';
import { closeDb, openDb, type Tx } from '../src/db';
import type { SpeakerGender } from '../src/dialog';
import { syncLlmPoolFromProjectSettings } from '../src/llm/llmProjectSettings';
import { normalizeVllmBaseUrl } from '../src/llm/vllmClient';
import { getAllProjectSettings } from '../src/web/services/projectSettings';
import type { DialogSceneContext, DialogSceneTurn } from '../src/llm/dialogScene';
import { windowDialogSceneTurns } from '../src/llm/dialogScene';
import { buildLlmParticipantPayload } from '../src/llm/dialogParticipants';
import { applyTranslateSplit, isMaskedLlmText, splitTranslateSource } from '../src/llm/textParts';
import { llmChatPipelineConcurrency, llmChatPool } from '../src/llm/requestPool';
import {
  isLlmTranslateMissingIdsError,
  translateStrings,
  type LlmTranslateItem,
  type LlmTranslateOptions,
  type LlmTranslateResult,
} from '../src/llm/translate';
import { verifyTranslationsWithLlm, type LlmVerifyVerdict } from '../src/llm/verifyTranslate';
import { selectRelevantGlossary } from '../src/llm/glossarySelect';
import { FO4_UK_GLOSSARY } from '../src/resources/glossary/fo4-uk';
import { mapWithConcurrency } from '../src/utils/concurrency';
import { unmask } from '../src/utils/placeholders';
import { getSceneTranscript } from '../src/web/data/queries/dialogs/sceneTranscript';
import type { DialogEntryRow, DialogTranscriptRow } from '../src/web/data/queries/dialogs/scope';

type ScenePick = {
  scene_id: number;
  scene_edid: string | null;
  mod_id: number;
  mod_name: string;
  quest_edid: string | null;
  quest_name: string | null;
  line_count: number;
};

type PreviewLine = {
  stringId: number;
  kind: 'prompt' | 'response';
  speaker: string;
  speakerGender: string;
  addressee: string;
  source: string;
  currentUk: string | null;
  newUk: string | null;
  verdict: LlmVerifyVerdict | 'error' | 'skipped';
  reason: string;
  confidence: number | null;
};

const argv = await yargs(hideBin(process.argv))
  .scriptName('fo4-uk-dialog-scene-preview')
  .option('out', { type: 'string', default: 'FO4-UK-dialogs.md', describe: 'Markdown report path' })
  .option('scenes', { type: 'number', default: 4, describe: 'How many scenes to pick' })
  .option('min-lines', { type: 'number', default: 8 })
  .option('max-lines', { type: 'number', default: 22 })
  .option('scene-id', { type: 'number', array: true, describe: 'Explicit dialog_scenes.id' })
  .help()
  .parse();

validateConfig();

const SRC_LANG = 'en';
const TARGET_LANG = 'uk';
const OUT_PATH = path.resolve(argv.out);

const resolveLiveChatModel = async (): Promise<string> => {
  const wanted = CONFIG.vllmModel;
  const hosts =
    CONFIG.vllmServers.length > 0
      ? CONFIG.vllmServers
      : [{ host: CONFIG.vllmBaseUrl, apiKey: CONFIG.vllmApiKey, maxParallel: 1 }];
  let lastError = 'no vLLM hosts';
  for (const server of hosts) {
    try {
      const response = await fetch(`${normalizeVllmBaseUrl(server.host)}/models`, {
        headers: { Authorization: `Bearer ${server.apiKey || CONFIG.vllmApiKey || 'EMPTY'}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        lastError = `GET /v1/models → ${response.status} (${server.host})`;
        continue;
      }
      const body = (await response.json()) as { data?: Array<{ id?: string }> };
      const ids = (body.data ?? []).map((row) => row.id).filter((id): id is string => Boolean(id));
      console.log(
        `vLLM host=${server.host} models=${ids.join(',') || '—'} wanted=${wanted || '—'}`,
      );
      if (wanted && ids.includes(wanted)) return wanted;
      if (ids[0]) {
        if (wanted && wanted !== ids[0]) {
          console.log(`VLLM_MODEL=${wanted} is not served; using ${ids[0]}`);
        }
        return ids[0];
      }
      if (wanted) return wanted;
      lastError = `vLLM at ${server.host} returned no models`;
    } catch (err) {
      lastError = `${server.host}: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  throw new Error(lastError);
};

const glossaryFor = (texts: string[]) => selectRelevantGlossary(FO4_UK_GLOSSARY, texts);

const pickScenes = async (db: Tx): Promise<ScenePick[]> => {
  const explicit = (argv['scene-id'] ?? []).filter((id) => Number.isFinite(id));
  if (explicit.length > 0) {
    const { rows } = await db.query<ScenePick>(
      `
      SELECT ds.id AS scene_id, ds.edid AS scene_edid, ds.mod_id, m.name AS mod_name,
             dq.edid AS quest_edid, dq.name AS quest_name, 0 AS line_count
        FROM dialog_scenes ds
        JOIN mods m ON m.id = ds.mod_id
        LEFT JOIN dialog_quests dq
          ON dq.mod_id = ds.mod_id AND dq.formid_hex = ds.quest_formid_hex
       WHERE ds.id = ANY($1::int[])
      `,
      [explicit],
    );
    return rows;
  }

  const { rows } = await db.query<ScenePick>(
    `
    SELECT ds.id AS scene_id,
           ds.edid AS scene_edid,
           ds.mod_id,
           m.name AS mod_name,
           dq.edid AS quest_edid,
           dq.name AS quest_name,
           COUNT(DISTINCT s.id)::int AS line_count
      FROM dialog_scenes ds
      JOIN mods m ON m.id = ds.mod_id
      LEFT JOIN dialog_quests dq
        ON dq.mod_id = ds.mod_id AND dq.formid_hex = ds.quest_formid_hex
      JOIN dialog_scene_phases dsp ON dsp.scene_id = ds.id
      JOIN dialog_topics dt ON dt.id = dsp.topic_id
      JOIN dialog_nodes dn ON dn.topic_id = dt.id
      JOIN records r ON r.mod_id = ds.mod_id AND r.formid_hex = dn.info_formid_hex
      JOIN strings s ON s.record_id = r.id AND s.lang = $3
     WHERE m.game = 'fo4'
       AND (m.name ILIKE 'Fallout4%' OR m.name ILIKE 'DLC%' OR m.name ILIKE 'cc%')
       AND r.signature = 'INFO'
       AND r.path_simplified IN ('INFO\\NAM1', 'INFO\\RNAM')
       AND length(trim(s.text_raw)) > 1
     GROUP BY ds.id, ds.edid, ds.mod_id, m.name, dq.edid, dq.name
    HAVING COUNT(DISTINCT s.id) BETWEEN $1 AND $2
     ORDER BY dq.edid NULLS LAST, ds.id
    `,
    [argv['min-lines'], argv['max-lines'], SRC_LANG],
  );

  const picked: ScenePick[] = [];
  const seenQuest = new Set<string>();
  for (const row of rows) {
    const quest = row.quest_edid ?? `scene:${row.scene_id}`;
    if (seenQuest.has(quest)) continue;
    seenQuest.add(quest);
    picked.push(row);
    if (picked.length >= argv.scenes) break;
  }
  return picked;
};

const flattenLines = (transcript: DialogTranscriptRow) => {
  const rows: Array<{
    entry: DialogEntryRow;
    line: DialogEntryRow['lines'][number];
  }> = [];
  const seen = new Set<number>();
  for (const entry of transcript.entries) {
    for (const line of entry.lines) {
      if (seen.has(line.string_id)) continue;
      if (!line.source.trim()) continue;
      seen.add(line.string_id);
      rows.push({ entry, line });
    }
  }
  return rows;
};

const speakerOf = (
  entry: DialogEntryRow,
  kind: 'prompt' | 'response',
): {
  speaker: string;
  speakerGender: SpeakerGender;
  addressee: string;
  addresseeGender: SpeakerGender;
} => {
  if (kind === 'prompt') {
    return {
      speaker: 'Player',
      speakerGender: 'any',
      addressee: entry.speaker ?? 'NPC',
      addresseeGender: entry.speaker_gender,
    };
  }
  return {
    speaker: entry.speaker ?? 'NPC',
    speakerGender: entry.speaker_gender,
    addressee: entry.addressee_kind === 'player' ? 'Player' : (entry.addressee ?? 'Player'),
    addresseeGender: entry.addressee_kind === 'player' ? 'any' : entry.addressee_gender,
  };
};

const toTranslateItem = (
  entry: DialogEntryRow,
  line: DialogEntryRow['lines'][number],
): {
  item: LlmTranslateItem;
  placeholderMap: Record<string, string>;
  functionKeywordMap: Record<string, string>;
} => {
  const field = line.kind === 'prompt' ? 'RNAM' : 'NAM1';
  const who = speakerOf(entry, line.kind);
  const split = splitTranslateSource(line.source, 'fo4', {
    grup: 'INFO',
    field,
  });
  return {
    item: applyTranslateSplit(
      {
        id: line.string_id,
        source: '',
        grup: 'INFO',
        edid: null,
        field,
        form_id: entry.info_formid_hex,
        context: line.context,
        ...buildLlmParticipantPayload({
          speakerName: who.speaker,
          speakerGender: who.speakerGender,
          addresseeName: who.addressee,
          addresseeGender: who.addresseeGender,
        }),
      },
      split,
    ),
    placeholderMap: split.placeholderMap,
    functionKeywordMap: split.functionKeywordMap,
  };
};

const sceneContext = (
  pick: ScenePick,
  transcript: DialogTranscriptRow,
  rows: ReturnType<typeof flattenLines>,
  translateIds: Set<number>,
): DialogSceneContext => {
  const turns: DialogSceneTurn[] = rows.map(({ entry, line }) => {
    const who = speakerOf(entry, line.kind);
    return {
      id: line.string_id,
      kind: line.kind,
      speaker: who.speaker,
      source: line.source,
      translation: line.translation,
      variantIndex: entry.variant_index,
      variantCount: entry.variant_count,
      translate: translateIds.has(line.string_id),
    };
  });
  return {
    questEdid: pick.quest_edid,
    sceneEdid: pick.scene_edid ?? transcript.label,
    timingSensitive: transcript.timing_sensitive,
    turns,
  };
};

const translateWindow = async (opts: LlmTranslateOptions): Promise<LlmTranslateResult[]> => {
  try {
    return await translateStrings(opts);
  } catch (err) {
    if (!isLlmTranslateMissingIdsError(err) || err.missingIds.length === 0) throw err;
    const missing = new Set(err.missingIds);
    const recovered = await mapWithConcurrency(
      opts.items.filter((item) => missing.has(item.id)),
      Math.min(err.missingIds.length, CONFIG.llmMaxParallel),
      async (item) => {
        const [row] = await translateStrings({ ...opts, items: [item] });
        return row;
      },
    );
    const byId = new Map(err.partialResults.map((row) => [row.id, row]));
    for (const row of recovered) {
      if (row) byId.set(row.id, row);
    }
    return opts.items.map((item) => {
      const row = byId.get(item.id);
      if (!row) throw err;
      return row;
    });
  }
};

const previewScene = async (db: Tx, pick: ScenePick): Promise<PreviewLine[]> => {
  const transcript = await getSceneTranscript(
    db,
    pick.mod_id,
    pick.scene_id,
    SRC_LANG,
    TARGET_LANG,
  );
  if (!transcript) throw new Error(`scene ${pick.scene_id} not found`);
  const rows = flattenLines(transcript);
  if (rows.length === 0) return [];

  const packed = rows.map(({ entry, line }) => ({
    ...toTranslateItem(entry, line),
    entry,
    line,
  }));
  const glossary = await glossaryFor(rows.map((row) => row.line.source));
  const windows = windowDialogSceneTurns(
    sceneContext(pick, transcript, rows, new Set(rows.map((row) => row.line.string_id))).turns,
    { maxTargets: CONFIG.batchSize },
  );

  const newById = new Map<number, string>();
  for (const turns of windows) {
    const targetIds = new Set(
      turns.filter((turn) => turn.translate && turn.id != null).map((turn) => turn.id!),
    );
    const chunk = packed.filter((row) => targetIds.has(row.line.string_id));
    const translated = await translateWindow({
      items: chunk.map((row) => row.item),
      model: MODEL,
      srcLang: SRC_LANG,
      targetLang: TARGET_LANG,
      game: 'fo4',
      promptFamily: 'dialog',
      modName: pick.mod_name,
      glossary,
      dialogScene: {
        questEdid: pick.quest_edid,
        sceneEdid: pick.scene_edid ?? transcript.label,
        timingSensitive: transcript.timing_sensitive,
        turns,
      },
    });
    for (const row of translated) {
      const pack = packed.find((item) => item.item.id === row.id);
      const text =
        pack && isMaskedLlmText(row.translation)
          ? unmask(unmask(row.translation, pack.functionKeywordMap), pack.placeholderMap)
          : row.translation;
      newById.set(row.id, text);
    }
  }

  const verifyItems = packed
    .filter((row) => newById.has(row.line.string_id))
    .map((row) => ({
      id: row.line.string_id,
      source: row.line.source,
      translation: newById.get(row.line.string_id)!,
      grup: 'INFO' as const,
      edid: null,
      field: row.item.field,
      context: row.line.context,
      speaker: row.item.speaker,
      speaker_gender: row.item.speaker_gender,
      addressee: row.item.addressee,
      addressee_gender: row.item.addressee_gender,
    }));

  let verified: Awaited<ReturnType<typeof verifyTranslationsWithLlm>> = [];
  let verifyError: string | null = null;
  if (verifyItems.length > 0) {
    try {
      verified = await verifyTranslationsWithLlm({
        items: verifyItems,
        model: MODEL,
        srcLang: SRC_LANG,
        targetLang: TARGET_LANG,
        game: 'fo4',
        promptFamily: 'dialog',
        modName: pick.mod_name,
        glossary,
        dialogScene: sceneContext(pick, transcript, rows, new Set(newById.keys())),
      });
    } catch (err) {
      verifyError = err instanceof Error ? err.message : String(err);
    }
  }
  const verdictById = new Map(verified.map((row) => [row.id, row]));

  return packed.map(({ entry, line }) => {
    const who = speakerOf(entry, line.kind);
    const audit = verdictById.get(line.string_id);
    const newUk = newById.get(line.string_id) ?? null;
    return {
      stringId: line.string_id,
      kind: line.kind,
      speaker: who.speaker,
      speakerGender: who.speakerGender,
      addressee: who.addressee,
      source: line.source,
      currentUk: line.translation,
      newUk,
      verdict: newUk ? (audit?.verdict ?? 'error') : 'skipped',
      reason:
        audit?.reason ??
        (newUk
          ? verifyError
            ? `Verify впав: ${verifyError}`
            : 'Немає вердикту verify'
          : 'Немає нового перекладу'),
      confidence: audit?.confidence ?? null,
    };
  });
};

const renderMd = (
  scenes: Array<{ pick: ScenePick; lines: PreviewLine[]; error?: string }>,
): string => {
  const all = scenes.flatMap((scene) => scene.lines);
  const counts = { ok: 0, suspicious: 0, incorrect: 0, error: 0, skipped: 0 };
  for (const line of all) counts[line.verdict] += 1;
  const out = [
    '# FO4 UK — прев’ю сцен (не залито)',
    '',
    `Згенеровано: ${new Date().toISOString()}`,
    `Провайдер: ${CONFIG.llmProvider} · модель: ${MODEL}`,
    `Пул: ${CONFIG.llmMaxParallel} слотів · сцени паралельно: ${llmChatPipelineConcurrency()}`,
    'У базу **не** писалось. Штатні `translateStrings` + `verifyTranslationsWithLlm` + `getSceneTranscript`.',
    '',
    '## Підсумок',
    '',
    `- сцен: ${scenes.length}`,
    `- рядків: ${all.length}`,
    `- ok: ${counts.ok} · suspicious: ${counts.suspicious} · incorrect: ${counts.incorrect} · error: ${counts.error} · skipped: ${counts.skipped}`,
    '',
  ];
  for (const scene of scenes) {
    const title = scene.pick.scene_edid ?? `scene ${scene.pick.scene_id}`;
    out.push(
      `## ${title}`,
      '',
      `квест \`${scene.pick.quest_edid ?? '—'}\` · ${scene.pick.quest_name ?? ''} · ${scene.pick.mod_name} · scene_id=${scene.pick.scene_id} · рядків ${scene.lines.length}`,
      '',
    );
    if (scene.error) {
      out.push(`**Помилка сцени:** ${scene.error}`, '');
      continue;
    }
    for (const line of scene.lines) {
      out.push(
        `### ${line.stringId} · ${line.kind} · ${line.speaker} (${line.speakerGender}) → ${line.addressee}`,
        '',
        `**EN:** ${line.source}`,
        '',
        `**Поточний UK:** ${line.currentUk?.trim() ? line.currentUk : '—'}`,
        '',
        `**Новий UK:** ${line.newUk?.trim() ? line.newUk : '—'}`,
        '',
        `**Вердикт:** ${line.verdict}${line.confidence != null ? ` (${line.confidence.toFixed(2)})` : ''}`,
        '',
        `**Чому:** ${line.reason}`,
        '',
      );
    }
  }
  return `${out.join('\n')}\n`;
};

let MODEL = CONFIG.vllmModel;

const db = openDb();
try {
  syncLlmPoolFromProjectSettings(await getAllProjectSettings(db));
  MODEL = await resolveLiveChatModel();
  const picks = await pickScenes(db);
  if (picks.length === 0) {
    throw new Error('Не знайшов офіційних FO4 сцен у заданому діапазоні рядків');
  }
  const sceneConcurrency = Math.min(picks.length, llmChatPipelineConcurrency());
  console.log(
    `preview scenes=${picks.length} concurrency=${sceneConcurrency} pool=${CONFIG.llmMaxParallel} inFlight=${llmChatPool.stats.inFlight}`,
  );
  const scenes = await mapWithConcurrency(picks, sceneConcurrency, async (pick) => {
    const started = Date.now();
    console.log(`scene ${pick.scene_id} ${pick.scene_edid ?? ''} start`);
    try {
      const lines = await previewScene(db, pick);
      console.log(`scene ${pick.scene_id} done ${lines.length} lines ${Date.now() - started}ms`);
      return { pick, lines };
    } catch (err) {
      console.log(`scene ${pick.scene_id} error ${Date.now() - started}ms`);
      return {
        pick,
        lines: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
  fs.writeFileSync(OUT_PATH, renderMd(scenes), 'utf8');
  console.log(`Wrote ${OUT_PATH} (${scenes.length} scenes, no DB writes)`);
} finally {
  await closeDb();
}
