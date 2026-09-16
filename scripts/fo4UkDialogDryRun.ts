/**
 * Dry-run FO4 UK dialog translate + recast on live official lines.
 * Reads prod Postgres, calls the real LLM, prints a comparison. Never writes.
 *
 *   npx tsx scripts/fo4UkDialogDryRun.ts
 */
import '../src/games';
import { CONFIG, getTranslateModel, validateConfig } from '../src/config';
import { closeDb, openDb } from '../src/db';
import { effectiveNarratorGenderSql } from '../src/dialog/narratorGender';
import { selectGlossaryByWordBoundary } from '../src/llm/glossarySelect';
import { loadFo4DialogLineGroups } from '../src/llm/fo4DialogChunks';
import { syncLlmPoolFromProjectSettings } from '../src/llm/llmProjectSettings';
import { syncLlmChatPool } from '../src/llm/requestPool';
import { isLlmTranslateMissingIdsError, translateStrings } from '../src/llm/translate';
import { getAllProjectSettings } from '../src/web/services/projectSettings';
import {
  DIALOG_PARTICIPANT_COLUMNS,
  DIALOG_PROMPT_PATH,
  DIALOG_RESPONSE_PATH,
  dialogParticipantsLateralSql,
} from '../src/web/data/queries/dialogs';
import { loadGlossaryTermsForGame } from '../src/web/data/queries';
import { prepareLlmItems } from '../worker/src/jobs/translate/batch/prepareRows';
import { buildFamilyTranslateChunks } from '../worker/src/jobs/translate/batch/familyChunks';
import type { StringRow } from '../worker/src/jobs/translate/batch/types';

const TARGET_LANG = 'uk';
const SRC_LANG = 'en';
const GAME = 'fo4';
const SCENE_CAP = 8;
const OFFICIAL_MODS = ['Fallout4', 'DLCCoast', 'DLCNukaWorld', 'DLCRobot', 'DLCworkshop03'];

/** Lines that leaked gender / calque / register in the quality review. */
const FLAG_IDS = [
  6440930, 6441557, 6475486, 6110127, 6515322, 6497599, 6457532, 6497257, 6500338, 6110419, 6111753,
  6515320,
];

/** Voice-control lines that were already good — must not regress. */
const CONTROL_IDS = [6438664, 6443593, 6497263, 6500336, 6515318, 6460158];

const EXTRA_SPEAKERS = [
  'Curie',
  'Codsworth',
  'Father',
  'Deacon',
  'X6-88',
  'Porter Gage',
  'DiMA',
  'Old Longfellow',
];

type PickRow = {
  id: number;
  bucket: string;
  speaker: string | null;
  source: string;
};

const officialModSql = `m.is_current AND m.name = ANY($1::text[])`;

const pickFlagAndControl = async (db: ReturnType<typeof openDb>): Promise<PickRow[]> => {
  const { rows } = await db.query<{
    id: number;
    speaker: string | null;
    source: string;
  }>(
    `SELECT s.id, nsp.display_name AS speaker, s.text_raw AS source
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN mods m ON m.id = r.mod_id
       LEFT JOIN dialog_nodes dn ON dn.info_formid_hex = r.formid_hex
       LEFT JOIN dialog_speakers nsp
         ON nsp.mod_id = r.mod_id AND nsp.speaker_key = dn.speaker_key
      WHERE s.id = ANY($2::int[])
        AND ${officialModSql}
        AND s.lang = $3
        AND s.is_ignored = FALSE`,
    [OFFICIAL_MODS, [...FLAG_IDS, ...CONTROL_IDS], SRC_LANG],
  );
  const flag = new Set(FLAG_IDS);
  return rows.map((row) => ({
    ...row,
    bucket: flag.has(row.id) ? 'flag' : 'control',
  }));
};

const pickExtraSpeakers = async (db: ReturnType<typeof openDb>): Promise<PickRow[]> => {
  const { rows } = await db.query<{
    id: number;
    speaker: string | null;
    source: string;
  }>(
    `SELECT DISTINCT ON (nsp.display_name)
            s.id, nsp.display_name AS speaker, s.text_raw AS source
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN mods m ON m.id = r.mod_id
       JOIN dialog_nodes dn ON dn.info_formid_hex = r.formid_hex
       JOIN dialog_speakers nsp
         ON nsp.mod_id = r.mod_id AND nsp.speaker_key = dn.speaker_key
      WHERE ${officialModSql}
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND r.path_simplified = $3
        AND dn.addressee_kind = 'player'
        AND nsp.display_name = ANY($4::text[])
        AND length(s.text_raw) BETWEEN 16 AND 160
      ORDER BY nsp.display_name, s.id`,
    [OFFICIAL_MODS, SRC_LANG, DIALOG_RESPONSE_PATH, EXTRA_SPEAKERS],
  );
  return rows.map((row) => ({ ...row, bucket: `extra:${row.speaker ?? '?'}` }));
};

const pickGenderedPlayer = async (db: ReturnType<typeof openDb>): Promise<PickRow[]> => {
  const { rows } = await db.query<{
    id: number;
    speaker: string | null;
    source: string;
    gender: string;
  }>(
    `SELECT DISTINCT ON (COALESCE(nsp.gender_override, nsp.detected_gender))
            s.id,
            nsp.display_name AS speaker,
            s.text_raw AS source,
            COALESCE(nsp.gender_override, nsp.detected_gender) AS gender
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN mods m ON m.id = r.mod_id
       JOIN dialog_nodes dn ON dn.info_formid_hex = r.formid_hex
       JOIN dialog_speakers nsp
         ON nsp.mod_id = r.mod_id AND nsp.speaker_key = dn.speaker_key
      WHERE ${officialModSql}
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND r.path_simplified = $3
        AND nsp.is_player = TRUE
        AND COALESCE(nsp.gender_override, nsp.detected_gender) IN ('male', 'female')
        AND s.text_raw ~* '\\m(I|I''m|I''ve|I was|I am)\\M'
        AND length(s.text_raw) BETWEEN 12 AND 140
      ORDER BY COALESCE(nsp.gender_override, nsp.detected_gender), s.id`,
    [OFFICIAL_MODS, SRC_LANG, DIALOG_RESPONSE_PATH],
  );
  return rows.map((row) => ({
    id: row.id,
    speaker: row.speaker,
    source: row.source,
    bucket: `gendered-player:${row.gender}`,
  }));
};

const pickSharedPrompts = async (db: ReturnType<typeof openDb>): Promise<PickRow[]> => {
  const { rows } = await db.query<{
    id: number;
    speaker: string | null;
    source: string;
  }>(
    `SELECT s.id, nsp.display_name AS speaker, s.text_raw AS source
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN mods m ON m.id = r.mod_id
       LEFT JOIN dialog_nodes dn ON dn.info_formid_hex = r.formid_hex
       LEFT JOIN dialog_speakers nsp
         ON nsp.mod_id = r.mod_id AND nsp.speaker_key = dn.speaker_key
      WHERE ${officialModSql}
        AND s.lang = $2
        AND s.is_ignored = FALSE
        AND r.path_simplified = $3
        AND s.id <> ALL($4::int[])
        AND s.text_raw ~* '\\m(I|I''m|I was|I agree|I think|I know)\\M'
        AND length(s.text_raw) BETWEEN 8 AND 80
      ORDER BY s.id
      LIMIT 6`,
    [OFFICIAL_MODS, SRC_LANG, DIALOG_PROMPT_PATH, FLAG_IDS],
  );
  return rows.map((row) => ({ ...row, bucket: 'extra:rnam' }));
};

const expandScenes = async (db: ReturnType<typeof openDb>, seeds: PickRow[]): Promise<number[]> => {
  const groups = await loadFo4DialogLineGroups(
    db,
    seeds.map((row) => row.id),
  );
  const sceneIds = [
    ...new Set(
      [...groups.values()].map((row) => row.scene_id).filter((id): id is number => id != null),
    ),
  ];
  const topicIds = [
    ...new Set(
      [...groups.values()]
        .filter((row) => row.scene_id == null && row.topic_id != null)
        .map((row) => row.topic_id as number),
    ),
  ];

  const neighborIds = new Set(seeds.map((row) => row.id));

  if (sceneIds.length > 0) {
    const { rows } = await db.query<{ id: number; scene_id: number; phase_order: number | null }>(
      `SELECT s.id, ds.id AS scene_id, dsp.phase_order
         FROM strings s
         JOIN records r ON r.id = s.record_id
         JOIN mods m ON m.id = r.mod_id
         JOIN dialog_nodes dn ON dn.info_formid_hex = r.formid_hex
         JOIN dialog_topics dt ON dt.id = dn.topic_id AND dt.mod_id = r.mod_id
         JOIN dialog_scene_phases dsp ON dsp.topic_id = dt.id
         JOIN dialog_scenes ds ON ds.id = dsp.scene_id AND ds.mod_id = r.mod_id
        WHERE ${officialModSql}
          AND ds.id = ANY($2::int[])
          AND s.lang = $3
          AND s.is_ignored = FALSE
          AND r.path_simplified IN ($4, $5)
        ORDER BY ds.id, dsp.phase_order NULLS LAST, s.id`,
      [OFFICIAL_MODS, sceneIds, SRC_LANG, DIALOG_RESPONSE_PATH, DIALOG_PROMPT_PATH],
    );
    const taken = new Map<number, number>();
    const seedSet = new Set(seeds.map((row) => row.id));
    for (const row of rows) {
      if (seedSet.has(row.id)) {
        neighborIds.add(row.id);
        taken.set(row.scene_id, (taken.get(row.scene_id) ?? 0) + 1);
      }
    }
    for (const row of rows) {
      const count = taken.get(row.scene_id) ?? 0;
      if (count >= SCENE_CAP) continue;
      if (neighborIds.has(row.id)) continue;
      neighborIds.add(row.id);
      taken.set(row.scene_id, count + 1);
    }
  }

  if (topicIds.length > 0) {
    const { rows } = await db.query<{ id: number; topic_id: number }>(
      `SELECT s.id, dt.id AS topic_id
         FROM strings s
         JOIN records r ON r.id = s.record_id
         JOIN mods m ON m.id = r.mod_id
         JOIN dialog_nodes dn ON dn.info_formid_hex = r.formid_hex
         JOIN dialog_topics dt ON dt.id = dn.topic_id AND dt.mod_id = r.mod_id
        WHERE ${officialModSql}
          AND dt.id = ANY($2::int[])
          AND s.lang = $3
          AND s.is_ignored = FALSE
          AND r.path_simplified IN ($4, $5)
        ORDER BY dt.id, s.id`,
      [OFFICIAL_MODS, topicIds, SRC_LANG, DIALOG_RESPONSE_PATH, DIALOG_PROMPT_PATH],
    );
    const taken = new Map<number, number>();
    for (const row of rows) {
      const count = taken.get(row.topic_id) ?? 0;
      if (count >= SCENE_CAP) continue;
      neighborIds.add(row.id);
      taken.set(row.topic_id, count + 1);
    }
  }

  return [...neighborIds];
};

const loadStringRows = async (
  db: ReturnType<typeof openDb>,
  ids: number[],
): Promise<StringRow[]> => {
  const { rows } = await db.query<StringRow>(
    `SELECT s.id, s.text_raw, s.text_norm, s.text_norm_nopunct, s.context,
            r.signature, r.path, r.edid, r.formid_hex, m.game, m.name AS mod_name,
            ${effectiveNarratorGenderSql('r')} AS narrator_gender,
            ${DIALOG_PARTICIPANT_COLUMNS}
       FROM strings s
       JOIN records r ON r.id = s.record_id
       JOIN mods m ON m.id = r.mod_id
       LEFT JOIN LATERAL (${dialogParticipantsLateralSql('r')}
       ) dp ON TRUE
      WHERE s.id = ANY($1::int[]) AND s.lang = $2`,
    [ids, SRC_LANG],
  );
  return rows;
};

const loadCurrentUk = async (
  db: ReturnType<typeof openDb>,
  ids: number[],
): Promise<Map<number, { text: string; status: string | null }>> => {
  const { rows } = await db.query<{ string_id: number; text: string; status: string | null }>(
    `SELECT t.src_string_id AS string_id, t.text, t.status
       FROM translations t
      WHERE t.src_string_id = ANY($1::int[]) AND t.target_lang = $2`,
    [ids, TARGET_LANG],
  );
  return new Map(rows.map((row) => [row.string_id, { text: row.text, status: row.status }]));
};

const main = async (): Promise<void> => {
  validateConfig();
  const db = openDb();
  const started = Date.now();

  try {
    syncLlmPoolFromProjectSettings(await getAllProjectSettings(db));
    // compose-run cannot hairpin to this host's LAN IP; keep the remote Gemma.
    const reachable = CONFIG.vllmServers.filter(
      (server) => !server.host.includes('192.168.50.140'),
    );
    if (reachable.length > 0 && reachable.length !== CONFIG.vllmServers.length) {
      CONFIG.vllmServers = reachable;
      CONFIG.llmMaxParallel = reachable.reduce((sum, server) => sum + server.maxParallel, 0);
      syncLlmChatPool(reachable, true);
    }
    const seedsOnly = process.argv.includes('--seeds-only');
    const skipDialogRecast = process.argv.includes('--skip-recast');
    const model = getTranslateModel();
    process.stderr.write(
      `provider=${CONFIG.llmProvider} model=${model} vllm=${CONFIG.vllmServers.map((s) => s.host).join(',')}\n`,
    );
    const seeds = [
      ...(await pickFlagAndControl(db)),
      ...(await pickExtraSpeakers(db)),
      ...(await pickGenderedPlayer(db)),
      ...(await pickSharedPrompts(db)),
    ];
    const seedById = new Map(seeds.map((row) => [row.id, row]));
    const ids = seedsOnly
      ? [...new Set(seeds.map((row) => row.id))]
      : await expandScenes(db, seeds);
    const stringRows = await loadStringRows(db, ids);
    const currentUk = await loadCurrentUk(db, ids);
    const rowById = new Map(stringRows.map((row) => [row.id, row]));

    const { llmPending } = prepareLlmItems(ids, rowById, { modGame: GAME }, () => undefined);
    const chunks = await buildFamilyTranslateChunks(db, llmPending, GAME);
    const glossaryAll = (
      await loadGlossaryTermsForGame(db, SRC_LANG, TARGET_LANG, GAME, {
        limit: 2000,
      })
    ).map((g) => ({ term: g.term, translation: g.translation }));

    const nextById = new Map<number, string>();
    let chunkIndex = 0;
    for (const chunk of chunks) {
      chunkIndex += 1;
      const glossary = selectGlossaryByWordBoundary(
        glossaryAll,
        chunk.map((item) => item.sourceText),
      );
      process.stderr.write(
        `chunk ${chunkIndex}/${chunks.length} n=${chunk.length} ids=${chunk.map((c) => c.stringId).join(',')}\n`,
      );
      const runChunk = async (items: typeof chunk) => {
        const results = await translateStrings({
          items: items.map((item) => item.llmItem),
          model,
          srcLang: SRC_LANG,
          targetLang: TARGET_LANG,
          game: GAME,
          promptFamily: 'dialog',
          dialogScene: items[0]?.dialogScene,
          glossary,
          skipDialogRecast,
        });
        for (const result of results) nextById.set(result.id, result.translation);
      };
      try {
        await runChunk(chunk);
      } catch (err) {
        if (isLlmTranslateMissingIdsError(err)) {
          for (const result of err.partialResults) nextById.set(result.id, result.translation);
          const missing = chunk.filter((item) => err.missingIds.includes(item.stringId));
          process.stderr.write(
            `chunk ${chunkIndex} missing=${err.missingIds.join(',')} retry ${missing.length}\n`,
          );
          for (const item of missing) {
            try {
              await runChunk([item]);
            } catch (retryErr) {
              process.stderr.write(
                `retry ${item.stringId} failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}\n`,
              );
            }
          }
          continue;
        }
        process.stderr.write(
          `chunk ${chunkIndex} failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }

    const report = ids
      .map((id) => {
        const row = rowById.get(id);
        const seed = seedById.get(id);
        const current = currentUk.get(id);
        return {
          id,
          bucket: seed?.bucket ?? 'scene',
          speaker: row?.speaker_name ?? seed?.speaker ?? null,
          speaker_gender: row?.speaker_gender ?? null,
          addressee: row?.addressee_name ?? null,
          addressee_gender: row?.addressee_gender ?? null,
          field: row?.path ?? null,
          en: row?.text_raw ?? '',
          current_uk: current?.text ?? null,
          current_status: current?.status ?? null,
          new_uk: nextById.get(id) ?? null,
          changed: (current?.text ?? null) !== (nextById.get(id) ?? null),
        };
      })
      .sort((a, b) => {
        const rank = (bucket: string): number => {
          if (bucket === 'flag') return 0;
          if (bucket.startsWith('gendered')) return 1;
          if (bucket.startsWith('extra')) return 2;
          if (bucket === 'control') return 3;
          return 4;
        };
        return rank(a.bucket) - rank(b.bucket) || a.id - b.id;
      });

    const summary = {
      model,
      provider: CONFIG.llmProvider,
      wrote_db: false,
      rag: false,
      seeds_only: seedsOnly,
      skip_dialog_recast: skipDialogRecast,
      elapsed_ms: Date.now() - started,
      seed_count: seeds.length,
      translated_count: report.filter((row) => row.new_uk).length,
      changed_count: report.filter((row) => row.changed && row.new_uk).length,
      seeds: seeds.map((row) => ({ id: row.id, bucket: row.bucket, speaker: row.speaker })),
      lines: report,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await closeDb();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
