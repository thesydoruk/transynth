/**
 * Carry a video's work over to a new version of its mod.
 *
 * Every Vortex import of a mod is a new `mods` row, and so a new asset; when
 * the video file itself did not change (same hash), the separation, the
 * phrases, their takes and the dub are as good for the new row as for the
 * old. The audio derived from the file alone is shared by hash; the takes and
 * the dub, which depend on the translation, are copied into the new asset's
 * folder so the old version can go away.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../db';
import { log } from '../logger';
import {
  resolveVideoAudioPath,
  videoAssetDir,
  videoAssetRelDir,
  videoAudioFile,
  videoAudioRelPath,
} from './audioStore';
import type { VideoAssetRow, VideoAssetStatus } from './types';

export type VideoCarryOutcome = { status: VideoAssetStatus; segments: number; dub: boolean };

const copyInto = (fromRel: string, toRel: string): boolean => {
  const from = resolveVideoAudioPath(fromRel);
  if (!fs.existsSync(from)) return false;
  const to = resolveVideoAudioPath(toRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return true;
};

export const carryVideoAsset = async (
  db: Tx,
  from: VideoAssetRow,
  to: VideoAssetRow,
  tgtLang: string,
): Promise<VideoCarryOutcome> => {
  if (from.fingerprint !== to.fingerprint) {
    throw new Error(`Video #${to.id}: cannot carry from #${from.id}, the files differ`);
  }
  const hasSource = videoAudioFile(from, 'source') != null;
  const hasSpeech = videoAudioFile(from, 'speech') != null;
  let status: VideoAssetStatus = hasSpeech ? 'separated' : hasSource ? 'uploaded' : 'registered';

  const { rows: segments } = await db.query<{
    idx: number;
    start_s: number;
    end_s: number;
    speaker: string | null;
    source_text: string;
    take_rel_path: string | null;
    take_similarity: number | null;
    take_version: string | null;
    tempo: number | null;
    overrun: boolean;
  }>(
    `SELECT idx, start_s, end_s, speaker, source_text, take_rel_path, take_similarity,
            take_version, tempo, overrun
       FROM video_segments WHERE video_id = $1 ORDER BY idx`,
    [from.id],
  );
  fs.rmSync(videoAssetDir(to), { recursive: true, force: true });
  await db.query(`DELETE FROM video_segments WHERE video_id = $1`, [to.id]);
  for (const seg of segments) {
    let takeRel: string | null = null;
    if (seg.take_rel_path) {
      const name = path.basename(seg.take_rel_path);
      const rel = path.join(videoAssetRelDir(to), 'takes', name);
      takeRel = copyInto(seg.take_rel_path, rel) ? rel : null;
    }
    await db.query(
      `INSERT INTO video_segments
         (video_id, idx, start_s, end_s, speaker, source_text, take_rel_path, take_similarity,
          take_version, tempo, overrun)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        to.id,
        seg.idx,
        seg.start_s,
        seg.end_s,
        seg.speaker,
        seg.source_text,
        takeRel,
        takeRel ? seg.take_similarity : null,
        takeRel ? seg.take_version : null,
        takeRel ? seg.tempo : null,
        takeRel ? seg.overrun : false,
      ],
    );
  }

  let dubRel: string | null = null;
  if (hasSpeech && from.dub_rel_path && from.dub_version) {
    const rel = videoAudioRelPath(to, 'dub', tgtLang);
    if (copyInto(from.dub_rel_path, rel)) {
      dubRel = rel;
      status = from.packed_version === from.dub_version ? 'packed' : 'dubbed';
    }
  }
  await db.query(
    `UPDATE video_assets
        SET audio_rel_path = $2, status = $3, dub_rel_path = $4, dub_version = $5,
            packed_version = $6, error = NULL, updated_at = NOW()
      WHERE id = $1`,
    [
      to.id,
      hasSource ? from.audio_rel_path : null,
      status,
      dubRel,
      dubRel ? from.dub_version : null,
      dubRel ? from.packed_version : null,
    ],
  );
  log.info(
    `Video #${to.id} ${to.file_name}: carried from #${from.id} (mod #${from.mod_id}): ${status}, ${segments.length} phrase(s)${dubRel ? ', dub' : ''}`,
  );
  return { status, segments: segments.length, dub: dubRel != null };
};
