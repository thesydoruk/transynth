/**
 * Load mod import metadata and string samples for locale audit.
 */
import type { Tx } from '../../db';
import { CONFIG, getTranslateModel } from '../../config';
import {
  detectLocaleWithLlm,
  LOCALE_DETECT_ALLOWED_LANGS,
  type LlmLocaleDetectResult,
  type LlmLocaleDetectSample,
} from '../../llm/localeDetect';
import type { GameType } from '../../types';

/** Max string rows sent to the LLM per audit. */
export const LOCALE_DETECT_MAX_SAMPLES = 100;

/** Default random sample size when caller does not override. */
export const LOCALE_DETECT_DEFAULT_SAMPLES = LOCALE_DETECT_MAX_SAMPLES;

const clampSampleSize = (sampleSize: number): number =>
  Math.max(1, Math.min(LOCALE_DETECT_MAX_SAMPLES, sampleSize));

/** Fisher–Yates shuffle (mutates array). */
const shuffleInPlace = <T>(items: T[]): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
};

export type ModLocaleAuditTarget = {
  modId: number;
  modName: string;
  importJobId: number | null;
  fileName: string | null;
  expectedLang: string;
  storedLang: string;
  isLocalized: boolean;
  game: GameType;
  importStatus: string | null;
  stringCount: number;
};

export type ModLocaleAuditReport = ModLocaleAuditTarget & {
  sampleSize: number;
  llm: LlmLocaleDetectResult;
};

type ModImportRow = {
  id: number;
  file_name: string;
  src_lang: string;
  is_localized: number;
  game: string;
  status: string;
};

const resolveModId = async (db: Tx, modId?: number, modName?: string): Promise<number> => {
  if (modId != null) return modId;
  if (!modName?.trim()) {
    throw new Error('Provide --mod-id or --mod-name');
  }

  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM mods WHERE name ILIKE $1 ORDER BY id LIMIT 2`,
    [modName.trim()],
  );
  if (rows.length === 0) throw new Error(`Mod not found: "${modName}"`);
  if (rows.length > 1) {
    throw new Error(`Multiple mods match "${modName}" — use --mod-id instead`);
  }
  return rows[0]!.id;
};

export const loadModLocaleAuditTarget = async (
  db: Tx,
  opts: { modId?: number; modName?: string; importId?: number },
): Promise<ModLocaleAuditTarget> => {
  const modId = await resolveModId(db, opts.modId, opts.modName);

  const { rows: modRows } = await db.query<{ id: number; name: string }>(
    `SELECT id, name FROM mods WHERE id = $1`,
    [modId],
  );
  const mod = modRows[0];
  if (!mod) throw new Error(`Mod id=${modId} not found`);

  let importRow: ModImportRow | undefined;

  if (opts.importId != null) {
    const { rows } = await db.query<ModImportRow>(
      `SELECT id, file_name, src_lang, is_localized, game, status
       FROM mod_imports WHERE id = $1 AND mod_id = $2`,
      [opts.importId, modId],
    );
    importRow = rows[0];
    if (!importRow) throw new Error(`Import job #${opts.importId} not found for mod ${modId}`);
  } else {
    const { rows } = await db.query<ModImportRow>(
      `SELECT id, file_name, src_lang, is_localized, game, status
       FROM mod_imports
       WHERE mod_id = $1
       ORDER BY updated_at DESC
       LIMIT 1`,
      [modId],
    );
    importRow = rows[0];
  }

  const { rows: langRows } = await db.query<{ lang: string; cnt: string }>(
    `SELECT s.lang, COUNT(*)::text AS cnt
     FROM strings s
     JOIN records r ON r.id = s.record_id
     WHERE r.mod_id = $1
     GROUP BY s.lang
     ORDER BY COUNT(*) DESC
     LIMIT 1`,
    [modId],
  );

  const { rows: countRows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM strings s
     JOIN records r ON r.id = s.record_id
     WHERE r.mod_id = $1`,
    [modId],
  );

  const stringCount = Number.parseInt(countRows[0]?.cnt ?? '0', 10);
  if (stringCount === 0) {
    throw new Error(`Mod "${mod.name}" (id=${modId}) has no imported strings`);
  }

  return {
    modId,
    modName: mod.name,
    importJobId: importRow?.id ?? null,
    fileName: importRow?.file_name ?? null,
    expectedLang: importRow?.src_lang ?? CONFIG.defaultSrcLang,
    storedLang: langRows[0]?.lang ?? CONFIG.defaultSrcLang,
    isLocalized: (importRow?.is_localized ?? 0) === 1,
    game: (importRow?.game as GameType) ?? 'fo4',
    importStatus: importRow?.status ?? null,
    stringCount,
  };
};

export const sampleModStringsForLocaleAudit = async (
  db: Tx,
  modId: number,
  sampleSize: number,
): Promise<LlmLocaleDetectSample[]> => {
  const limit = clampSampleSize(sampleSize);
  const { rows } = await db.query<{
    id: number;
    text_raw: string;
    signature: string | null;
    path: string | null;
    edid: string | null;
  }>(
    `SELECT s.id, s.text_raw, r.signature, r.path, r.edid
     FROM strings s
     JOIN records r ON r.id = s.record_id
     WHERE s.id IN (
       SELECT s2.id
       FROM strings s2
       JOIN records r2 ON r2.id = s2.record_id
       WHERE r2.mod_id = $1
         AND length(trim(s2.text_raw)) >= 4
         AND s2.text_raw ~ '[[:alpha:]]'
       ORDER BY random()
       LIMIT $2
     )`,
    [modId, limit],
  );

  if (rows.length === 0) {
    throw new Error(`No suitable string samples found for mod id=${modId}`);
  }

  const samples = rows.map((row) => ({
    id: row.id,
    text: row.text_raw,
    signature: row.signature,
    path: row.path,
    edid: row.edid,
  }));

  return shuffleInPlace(samples);
};

export const listModLocaleAuditTargets = async (
  db: Tx,
  status: 'completed' | 'any' = 'completed',
): Promise<ModLocaleAuditTarget[]> => {
  const statusFilter = status === 'completed' ? `AND mi.status = 'completed'` : '';
  const { rows } = await db.query<{ mod_id: number }>(
    `SELECT DISTINCT ON (mi.mod_id) mi.mod_id
     FROM mod_imports mi
     WHERE mi.mod_id IS NOT NULL ${statusFilter}
     ORDER BY mi.mod_id, mi.updated_at DESC`,
  );

  const targets: ModLocaleAuditTarget[] = [];
  for (const row of rows) {
    targets.push(await loadModLocaleAuditTarget(db, { modId: row.mod_id }));
  }
  return targets;
};

export const auditModLocale = async (
  db: Tx,
  opts: {
    modId?: number;
    modName?: string;
    importId?: number;
    sampleSize?: number;
    model?: string;
  },
): Promise<ModLocaleAuditReport> => {
  const target = await loadModLocaleAuditTarget(db, opts);
  const samples = await sampleModStringsForLocaleAudit(
    db,
    target.modId,
    opts.sampleSize ?? LOCALE_DETECT_DEFAULT_SAMPLES,
  );
  const llm = await detectLocaleWithLlm({
    samples,
    model: opts.model ?? getTranslateModel(),
    expectedLang: target.expectedLang,
    storedLang: target.storedLang,
    isLocalized: target.isLocalized,
    allowedLanguages: LOCALE_DETECT_ALLOWED_LANGS,
    game: target.game,
    modName: target.modName,
    fileName: target.fileName,
  });

  return {
    ...target,
    sampleSize: samples.length,
    llm,
  };
};

/** Human-readable hint when import locale likely wrong. */
export const formatLocaleAuditHint = (report: ModLocaleAuditReport): string | null => {
  const expected = report.expectedLang.trim().toLowerCase();
  const detected = report.llm.overall_detected_language;

  if (report.llm.verdict === 'match' && report.llm.matches_expected) return null;
  if (report.llm.verdict === 'uncertain' || detected === 'unknown') {
    return `Uncertain locale (${report.llm.summary})`;
  }
  if (report.llm.verdict === 'mixed') {
    return `Mixed languages in samples — possible embedded translation (expected ${expected})`;
  }
  if (detected !== expected) {
    return `Text looks like "${detected}" but import expected "${expected}" (${report.llm.summary})`;
  }
  if (!report.llm.matches_expected) {
    return report.llm.summary;
  }
  return null;
};
