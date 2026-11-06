/**
 * Keep the server's view of the cutscene videos current: register every video
 * the scan found, and upload the source audio track of those the server does
 * not hold yet (new, or swapped since — the fingerprint tells).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileAsync } from '../../utils/execFile';
import type { VideoScanEntry } from './videoScan';

export type VideoAssetView = {
  id: number;
  file_name: string;
  fingerprint: string;
  audio_rel_path: string | null;
};

export type VideoSyncApi = {
  listVideos: (game: string) => Promise<{ assets: VideoAssetView[] }>;
  registerVideo: (
    game: string,
    body: Record<string, unknown>,
  ) => Promise<{ asset: { id: number } }>;
  putVideoAudio: (game: string, id: number, wavPath: string) => Promise<void>;
};

export type VideoSyncOutcome = { registered: number; uploaded: number; skipped: number };

/** Decode one Bink audio stream to 48 kHz stereo PCM WAV, the form the server expects. */
export const extractVideoTrack = async (
  ffmpegPath: string,
  absPath: string,
  streamIndex: number,
  outWav: string,
): Promise<void> => {
  fs.mkdirSync(path.dirname(outWav), { recursive: true });
  await execFileAsync(ffmpegPath, [
    '-y',
    '-v',
    'error',
    '-i',
    absPath,
    '-map',
    `0:${streamIndex}`,
    '-ac',
    '2',
    '-ar',
    '48000',
    '-c:a',
    'pcm_s16le',
    outWav,
  ]);
};

export type SyncVideosOptions = {
  game: string;
  agentKey: string;
  entries: VideoScanEntry[];
  api: VideoSyncApi;
  ffmpegPath: string;
  /** Where the WAV is written before upload; a temp folder when unset. */
  workDir?: string;
  extract?: typeof extractVideoTrack;
  log?: (line: string) => void;
};

/** The server already holds this video's audio for this very file. */
const serverHasAudio = (known: VideoAssetView | undefined, entry: VideoScanEntry): boolean =>
  known != null && known.fingerprint === entry.fingerprint && known.audio_rel_path != null;

export const syncVideos = async (opts: SyncVideosOptions): Promise<VideoSyncOutcome> => {
  const extract = opts.extract ?? extractVideoTrack;
  const { assets } = await opts.api.listVideos(opts.game);
  const known = new Map(assets.map((a) => [a.file_name.toLowerCase(), a]));
  const outcome: VideoSyncOutcome = { registered: 0, uploaded: 0, skipped: 0 };
  const workDir = opts.workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-video-'));
  try {
    for (const entry of opts.entries) {
      if (serverHasAudio(known.get(entry.fileName.toLowerCase()), entry)) {
        outcome.skipped += 1;
        continue;
      }
      const { asset } = await opts.api.registerVideo(opts.game, {
        fileName: entry.fileName,
        byteSize: entry.byteSize,
        fingerprint: entry.fingerprint,
        durationS: entry.durationS,
        trackIds: entry.trackIds,
        sourceTrackId: entry.sourceTrackId,
        agentKey: opts.agentKey,
      });
      outcome.registered += 1;
      const wav = path.join(workDir, `${path.parse(entry.fileName).name}.wav`);
      try {
        await extract(opts.ffmpegPath, entry.absPath, entry.sourceStreamIndex, wav);
        await opts.api.putVideoAudio(opts.game, asset.id, wav);
      } finally {
        fs.rmSync(wav, { force: true });
      }
      outcome.uploaded += 1;
      opts.log?.(`video ${entry.fileName}: track ${entry.sourceTrackId} uploaded as #${asset.id}`);
    }
  } finally {
    if (!opts.workDir) fs.rmSync(workDir, { recursive: true, force: true });
  }
  return outcome;
};
