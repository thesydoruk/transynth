import { execFileAsync } from '../../../utils/execFile';
import { resolveFfmpegPath } from '../../voiceToolPaths';

/** Probe media duration in seconds via ffprobe (ships next to ffmpeg). */
export const probeAudioDurationSec = async (inputPath: string): Promise<number | null> => {
  const ffmpeg = resolveFfmpegPath();
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_m, ext: string | undefined) =>
    ext ? `ffprobe${ext}` : 'ffprobe',
  );
  try {
    const { stdout } = await execFileAsync(ffprobe, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ]);
    const value = Number(stdout.trim());
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
};
