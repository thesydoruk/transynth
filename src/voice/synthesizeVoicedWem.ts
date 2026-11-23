/**
 * Build a Starfield take from TTS audio: a `.wem` and the `.ffxanim` lip
 * animation that goes beside it.
 *
 * The engine compares the two durations and rejects a pair that disagree, so
 * both are made from one WAV — at the sample rate the title's codec encodes
 * from, so the encoder is handed exactly the samples the animation was timed
 * on. The take's own stated length is checked against that WAV before it is
 * returned: a codec that pads or trims would otherwise ship takes the game
 * refuses.
 *
 * Which Wwise codec the take uses is the title's choice ({@link WemTakeCodec});
 * nothing here knows one from another.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { WemTakeCodec } from '../formats/wem';
import { generateFfxanimFile, type FaceFxActorSex } from './faceFx/generateFfxanim';
import { convertToMonoWav, writeTempWav } from './ffmpegAudio';
import { wavDurationSec } from './speakerReference/pcm';
import type { BuildVoiceTakeInput, BuiltVoiceTake } from './takeFormat/types';

export const FFXANIM_EXTENSION = '.ffxanim';

/**
 * Face rig used when the speaker's sex is unknown. The rig only shapes the
 * mouth poses, so a wrong guess costs fidelity, not a broken take; male is
 * what the gender heuristics already assume for robots and creatures.
 */
export const DEFAULT_FACEFX_ACTOR: FaceFxActorSex = 'male';

/** How far a take's length may differ from the WAV it and its animation were made from. */
const MAX_DURATION_DRIFT_SEC = 0.02;

const takeStem = (fileName: string): string => fileName.replace(/\.[^.]+$/, '');

const readSourceTake = (sourceTakePath: string | undefined): Buffer | null => {
  if (!sourceTakePath) return null;
  try {
    return fs.readFileSync(sourceTakePath);
  } catch {
    return null;
  }
};

export const buildVoicedWemFromTtsWav = async (
  input: BuildVoiceTakeInput,
  codec: WemTakeCodec,
): Promise<BuiltVoiceTake> => {
  const stem = takeStem(input.fileName);
  const rawWav = path.join(input.workDir, `${stem}.raw.wav`);
  const takeWav = path.join(input.workDir, `${stem}.wav`);
  const ffxanimPath = path.join(input.workDir, `${stem}${FFXANIM_EXTENSION}`);
  const sourceTake = readSourceTake(input.sourceTakePath);

  writeTempWav(rawWav, input.ttsWav);
  await convertToMonoWav(rawWav, takeWav, codec.takeSampleRate(sourceTake));

  const [wem] = await Promise.all([
    codec.encodeFromWav(takeWav, { sourceTake }),
    generateFfxanimFile(
      input.game,
      takeWav,
      ffxanimPath,
      input.text,
      input.actor ?? DEFAULT_FACEFX_ACTOR,
    ),
  ]);
  if (!fs.existsSync(ffxanimPath) || fs.statSync(ffxanimPath).size === 0) {
    throw new Error(`Lip animation was not created: ${path.basename(ffxanimPath)}`);
  }
  const drift = Math.abs(codec.durationSeconds(wem) - wavDurationSec(takeWav));
  if (drift > MAX_DURATION_DRIFT_SEC) {
    throw new Error(
      `Encoded take is ${drift.toFixed(3)}s off the audio its lip animation was made from`,
    );
  }

  return {
    data: wem,
    sidecars: [{ extension: FFXANIM_EXTENSION, data: fs.readFileSync(ffxanimPath) }],
    ...(input.includePreviewWav ? { previewWav: fs.readFileSync(takeWav) } : {}),
  };
};
