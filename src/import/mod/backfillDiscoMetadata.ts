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
import { parseDiscoPoPathForSignature } from './discoPoPath';
import {
  classifyDiscoPoSignature,
  discoPoSignatureSqlValues,
  type DiscoPoSignature,
} from './discoPoSignature';
import { buildDiscoSpeakerRowsFromStems, persistDiscoSpeakers } from './discoSpeakers';
import { persistDiscoVoiceClips } from '../../voice/disco/persistVoiceClips';
import { listDiscoModsWithExtract, type DiscoNaSourceTarget } from './repairDiscoNaSource';

export { parseDiscoPoPathForSignature };

export type BackfillDiscoMetadataResult = {
  modId: number;
  name: string;
  scanned: number;
  signaturesUpdated: number;
  speakers: number;
  clips: number;
};

const resolveExtractDir = (extractDir: string): string => {
  if (fs.existsSync(extractDir)) return extractDir;
  const mapped = extractDir.replace(/^[/\\]app[/\\]data(?=[/\\]|$)/, PATHS.dataDir);
  if (mapped !== extractDir && fs.existsSync(mapped)) return mapped;
  return extractDir;
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

/** Reclassify `records.signature`, rebuild `dialog_speakers`, and persist wav clips. */
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

  let clipCount = stems.length;
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
    clipCount = await persistDiscoVoiceClips(db, target.id, extractDir);
  }

  return {
    modId: target.id,
    name: target.name,
    scanned: pathRows.length,
    signaturesUpdated,
    speakers: speakerCount,
    clips: clipCount,
  };
};
