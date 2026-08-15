/**
 * Backfill Disco record signatures (DLG/GEN/FX) and speakers for already-imported mods.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import { PATHS } from '../../paths';
import {
  discoverDiscoVoiceFiles,
  resolveDiscoVoiceExtractRoot,
} from '../../voice/disco/discoverDiscoVoiceFiles';
import {
  classifyDiscoPoSignature,
  discoPoSignatureSqlValues,
  type DiscoPoSignature,
} from './discoPoSignature';
import { buildDiscoSpeakerRowsFromStems, persistDiscoSpeakers } from './discoSpeakers';
import { listDiscoModsWithExtract, type DiscoNaSourceTarget } from './repairDiscoNaSource';

export type BackfillDiscoMetadataResult = {
  modId: number;
  name: string;
  scanned: number;
  signaturesUpdated: number;
  speakers: number;
};

const resolveExtractDir = (extractDir: string): string => {
  if (fs.existsSync(extractDir)) return extractDir;
  const mapped = extractDir.replace(/^[/\\]app[/\\]data(?=[/\\]|$)/, PATHS.dataDir);
  if (mapped !== extractDir && fs.existsSync(mapped)) return mapped;
  return extractDir;
};

/** Parse `PO\relPo\msgctxt::…` into file + msgctxt for classification. */
export const parseDiscoPoPathForSignature = (
  recordPath: string,
): { relPo: string; msgctxt: string } | null => {
  // Import always writes `PO\relPo\entryKey`; msgctxt may contain `/`.
  if (!recordPath.toUpperCase().startsWith('PO\\') && !recordPath.toUpperCase().startsWith('PO/')) {
    return null;
  }
  const rest = recordPath.slice(3);
  const sep = rest.indexOf('\\');
  if (sep < 0) return null;
  const relPo = rest.slice(0, sep).replace(/\\/g, '/');
  const entryKey = rest.slice(sep + 1);
  const ctxSep = entryKey.indexOf('::');
  const msgctxt = ctxSep >= 0 ? entryKey.slice(0, ctxSep) : entryKey;
  return { relPo, msgctxt };
};

export const listDiscoModsForMetadataBackfill = listDiscoModsWithExtract;

const collectWavStems = (extractRoot: string, absPath: string | null): string[] => {
  const roots = new Set<string>();
  if (fs.existsSync(extractRoot)) roots.add(extractRoot);
  if (absPath) {
    const fromPlugin = resolveDiscoVoiceExtractRoot(absPath);
    if (fromPlugin) roots.add(fromPlugin);
  }
  const stems = new Set<string>();
  for (const root of roots) {
    for (const entry of discoverDiscoVoiceFiles(root)) {
      stems.add(path.basename(entry.fileName, path.extname(entry.fileName)));
    }
  }
  return [...stems];
};

/** Reclassify `records.signature` and rebuild `dialog_speakers` from Audio stems. */
export const backfillDiscoMetadataForMod = async (
  db: Tx,
  target: DiscoNaSourceTarget,
  opts: { dryRun?: boolean } = {},
): Promise<BackfillDiscoMetadataResult> => {
  const extractDir = resolveExtractDir(target.extract_dir);
  if (!fs.existsSync(extractDir)) {
    throw new Error(`Extract dir missing for mod ${target.id}: ${extractDir}`);
  }

  const { rows: pathRows } = await db.query<{ id: number; path: string; signature: string }>(
    `SELECT id, path, signature
     FROM records
     WHERE mod_id = $1
       AND signature = ANY($2::text[])`,
    [target.id, discoPoSignatureSqlValues()],
  );

  const updates = new Map<DiscoPoSignature, number[]>();
  for (const row of pathRows) {
    const parsed = parseDiscoPoPathForSignature(row.path);
    if (!parsed) continue;
    const next = classifyDiscoPoSignature(parsed.relPo, parsed.msgctxt);
    if (next === row.signature) continue;
    const list = updates.get(next) ?? [];
    list.push(row.id);
    updates.set(next, list);
  }

  let signaturesUpdated = 0;
  for (const ids of updates.values()) signaturesUpdated += ids.length;

  const { rows: modPathRows } = await db.query<{ abs_path: string | null }>(
    `SELECT abs_path FROM mods WHERE id = $1`,
    [target.id],
  );
  const stems = collectWavStems(extractDir, modPathRows[0]?.abs_path ?? null);
  const speakerCount = buildDiscoSpeakerRowsFromStems(stems).speakers.length;

  if (!opts.dryRun) {
    for (const [signature, ids] of updates) {
      for (let i = 0; i < ids.length; i += 500) {
        const slice = ids.slice(i, i + 500);
        await db.query(`UPDATE records SET signature = $2 WHERE id = ANY($1::int[])`, [
          slice,
          signature,
        ]);
      }
    }
    await persistDiscoSpeakers(db, target.id, stems);
  }

  return {
    modId: target.id,
    name: target.name,
    scanned: pathRows.length,
    signaturesUpdated,
    speakers: speakerCount,
  };
};
