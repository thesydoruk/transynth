import type { Tx } from '../../../db';
import { log } from '../../../logger';
import { CONFIG } from '../../../config';
import { bulkUpsertImportTranslations, type BulkTranslationRow } from '../../../import/bulk';
import {
  normalizePath,
  normalizeFormId,
  normalizeEdid,
  putUnique,
} from './importApplyHelpers';
import { loadImportedModLocaleRows } from './importApplyLoad';
import { resolveImportedCandidate } from './importApplyMatch';

export const applyImportedModStringsAsTranslations = async (
  db: Tx,
  targetModId: number,
  fromImportedModId: number,
  importedLang: string,
  targetLang = importedLang,
  srcLang = CONFIG.defaultSrcLang,
  opts?: {
    onProgress?: (
      processed: number,
      total: number,
      stats: { applied: number; skipped: number; unmatched: number; empty: number },
    ) => void | Promise<void>;
    shouldCancel?: () => boolean;
  },
): Promise<{
  applied: number;
  skipped: number;
  unmatched: number;
  empty: number;
  cancelled?: boolean;
}> => {
  const importedRows = await loadImportedModLocaleRows(db, fromImportedModId, importedLang);

  if (importedRows.length === 0) {
    throw new Error(
      `Imported mod has no strings or translations for lang "${importedLang}"`,
    );
  }

  return applyImportedRowsAsTranslations(
    db,
    targetModId,
    importedRows,
    importedLang,
    targetLang,
    srcLang,
    `imported_mod_${fromImportedModId}_${importedLang}`,
    `Imported apply: targetMod=${targetModId}, importedMod=${fromImportedModId}`,
    opts?.onProgress,
    opts?.shouldCancel,
  );
};

/** DB write and progress report interval (rows) for apply-imported translation copy. */
export const APPLY_IMPORTED_BATCH_SIZE = 500;

/** Count target mod source strings eligible for imported translation apply. */
export const countApplyImportedTargetStrings = async (
  db: Tx,
  targetModId: number,
  srcLang: string,
): Promise<number> => {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
       FROM strings s
       JOIN records r ON s.record_id = r.id
      WHERE r.mod_id = $1 AND s.lang = $2 AND s.is_ignored = FALSE`,
    [targetModId, srcLang],
  );
  return Number.parseInt(rows[0]?.cnt ?? '0', 10);
};

export const applyImportedRowsAsTranslations = async (
  db: Tx,
  targetModId: number,
  importedRows: Array<{
    formid_hex: string;
    path: string;
    path_simplified: string | null;
    signature: string | null;
    edid: string | null;
    text_raw: string;
  }>,
  importedLang: string,
  targetLang = importedLang,
  srcLang = CONFIG.defaultSrcLang,
  provenance = `imported_rows_${importedLang}`,
  logLabel = `Imported apply: targetMod=${targetModId}`,
  onProgress?: (
    processed: number,
    total: number,
    stats: { applied: number; skipped: number; unmatched: number; empty: number },
  ) => void | Promise<void>,
  shouldCancel?: () => boolean,
): Promise<{
  applied: number;
  skipped: number;
  unmatched: number;
  empty: number;
  cancelled?: boolean;
}> => {
  // Step 1: Load target mod source strings that should receive translations.
  const { rows: targetRows } = await db.query(
    `SELECT s.id AS string_id,
            r.formid_hex,
            r.path,
            r.path_simplified,
            r.signature,
            r.edid,
            ROW_NUMBER() OVER (
              PARTITION BY r.formid_hex, r.path
              ORDER BY s.id
            )::int AS identity_rank
     FROM strings s
     JOIN records r ON s.record_id = r.id
     WHERE r.mod_id = $1 AND s.lang = $2 AND s.is_ignored = FALSE`,
    [targetModId, srcLang],
  );

  if (targetRows.length === 0) {
    throw new Error(`Target mod has no source strings for lang "${srcLang}"`);
  }

  const byIdentity = new Map<string, string | null>();
  const byFormIdSignaturePath = new Map<string, string | null>();
  const byFormIdSignature = new Map<string, string | null>();
  const byEdidSignaturePath = new Map<string, string | null>();
  const byEdidPath = new Map<string, string | null>();
  const byEdidSignature = new Map<string, string | null>();
  const byFormIdOnly = new Map<string, string | null>();
  const identityBuckets = new Map<string, string[]>();

  for (const row of importedRows as Array<{
    formid_hex: string;
    path: string;
    path_simplified: string | null;
    signature: string | null;
    edid: string | null;
    text_raw: string;
  }>) {
    const translated = (row.text_raw ?? '').trim();
    if (!translated) continue;

    const formId = normalizeFormId(row.formid_hex);
    const pathRaw = normalizePath(row.path);
    const pathSimplified = normalizePath(row.path_simplified) || pathRaw;
    const signature = (row.signature ?? '').trim().toUpperCase();
    const edid = normalizeEdid(row.edid);
    const identityKey = `${formId}|${pathRaw}`;

    putUnique(byIdentity, identityKey, translated);
    if (!identityBuckets.has(identityKey)) identityBuckets.set(identityKey, []);
    identityBuckets.get(identityKey)!.push(translated);

    if (signature) {
      putUnique(byFormIdSignaturePath, `${formId}|${signature}|${pathSimplified}`, translated);
      putUnique(byFormIdSignature, `${formId}|${signature}`, translated);
    }
    if (edid) {
      putUnique(byEdidPath, `${edid}|${pathRaw}`, translated);
      if (signature) {
        putUnique(byEdidSignaturePath, `${edid}|${signature}|${pathSimplified}`, translated);
        putUnique(byEdidSignature, `${edid}|${signature}`, translated);
      }
    }
    putUnique(byFormIdOnly, formId, translated);
  }

  const targetStringIds = (targetRows as Array<{ string_id: number }>).map((r) => r.string_id);
  const alreadyTranslated = new Set<number>();
  if (targetStringIds.length > 0) {
    const { rows: existing } = await db.query(
      `SELECT DISTINCT src_string_id
       FROM translations
       WHERE src_string_id = ANY($1) AND target_lang = $2`,
      [targetStringIds, targetLang],
    );
    for (const row of existing as Array<{ src_string_id: number }>) {
      alreadyTranslated.add(row.src_string_id);
    }
  }

  let applied = 0;
  let skipped = 0;
  let unmatched = 0;
  let empty = 0;
  let processed = 0;
  let pendingApplies: BulkTranslationRow[] = [];
  const matchCounters: Record<string, number> = {
    identity: 0,
    identity_ranked: 0,
    formid_signature_path: 0,
    edid_signature_path: 0,
    edid_path: 0,
    edid_signature: 0,
    formid_signature: 0,
    formid_only: 0,
  };

  const flushPendingApplies = async (): Promise<void> => {
    if (pendingApplies.length === 0) return;
    const flushed = await bulkUpsertImportTranslations(
      db,
      pendingApplies,
      targetLang,
      provenance,
      APPLY_IMPORTED_BATCH_SIZE,
      'draft',
    );
    applied += flushed;
    pendingApplies = [];
  };

  const reportProgress = async () => {
    if (
      onProgress &&
      (processed % APPLY_IMPORTED_BATCH_SIZE === 0 ||
        processed === targetRows.length ||
        shouldCancel?.())
    ) {
      await onProgress(processed, targetRows.length, { applied, skipped, unmatched, empty });
    }
  };

  for (const row of targetRows as Array<{
    string_id: number;
    formid_hex: string;
    path: string;
    path_simplified: string | null;
    signature: string | null;
    edid: string | null;
    identity_rank: number;
  }>) {
    if (shouldCancel?.()) {
      await flushPendingApplies();
      break;
    }

    if (alreadyTranslated.has(row.string_id)) {
      skipped += 1;
      processed += 1;
      await reportProgress();
      continue;
    }

    const candidate = resolveImportedCandidate(row, {
      byIdentity,
      byFormIdSignaturePath,
      byFormIdSignature,
      byEdidSignaturePath,
      byEdidPath,
      byEdidSignature,
      byFormIdOnly,
      identityBuckets,
    });
    if (candidate == null) {
      unmatched += 1;
      processed += 1;
      await reportProgress();
      continue;
    }

    const text = candidate.text.trim();
    if (!text) {
      empty += 1;
      processed += 1;
      await reportProgress();
      continue;
    }

    matchCounters[candidate.method] += 1;

    pendingApplies.push({ srcStringId: row.string_id, text });
    if (pendingApplies.length >= APPLY_IMPORTED_BATCH_SIZE) {
      await flushPendingApplies();
    }
    processed += 1;
    await reportProgress();
  }

  await flushPendingApplies();

  const cancelled = shouldCancel?.() === true && processed < targetRows.length;

  if (onProgress && processed !== targetRows.length && !cancelled) {
    await onProgress(targetRows.length, targetRows.length, { applied, skipped, unmatched, empty });
  }

  log.info(
    `${logLabel}, srcLang=${srcLang}, importedLang=${importedLang}, targetLang=${targetLang}, ` +
      `applied=${applied}, skipped=${skipped}, unmatched=${unmatched}, empty=${empty}, ` +
      `methods=${JSON.stringify(matchCounters)}${cancelled ? ', cancelled=true' : ''}`,
  );

  return { applied, skipped, unmatched, empty, ...(cancelled ? { cancelled: true } : {}) };
};
