/**
 * Turn a synthesized line into what a `.w3speech` row holds: an Opus take with
 * its duration, and a mouth animation that fits it.
 *
 * The mouth comes from the mimic model when one has been trained on the
 * player's install; without it, the original line's animation is stretched to
 * the new length — the shapes are English, the timing is ours, which is what
 * fan dubs of the game have shipped.
 */
import { MIMIC_SAMPLE_RATE } from '../mimic/features';
import { LIP_TAIL_SECONDS } from '../mimic/generate';
import { generateLipsyncBlockOffThread } from '../mimic/lipsyncPool';
import type { MimicModel } from '../mimic/model';
import {
  encodeAudioToOpusWem,
  encodeAudioToOpusWemWithPcm,
  opusWemDuration,
  parseOpusWem,
} from '../audio/opusWem';
import { buildW3SpeechAudio, parseW3SpeechAudio } from '../w3speech';
import { retimeLipsync } from '../w3speech/lipsync';

export type W3TakeBuild = {
  audio: Buffer;
  /** Empty when the original line had no animation either. */
  lip: Buffer;
  duration: number;
  lipSource: 'model' | 'retimed' | 'none';
};

export type BuildW3TakeInput = {
  /** The synthesized line, any format ffmpeg reads. */
  audioPath: string;
  /** The original row's audio block, whose take's format the new one copies. */
  originalAudio: Buffer;
  /** The original row's lip block (may be empty). */
  originalLip: Buffer;
  model?: MimicModel | null;
  /**
   * The file `model` was loaded from. Given, the animation is generated on a
   * worker thread (see `lipsyncPool.ts`); without it, on this one.
   */
  modelPath?: string | null;
};

export const buildW3Take = async (input: BuildW3TakeInput): Promise<W3TakeBuild> => {
  const original = parseW3SpeechAudio(input.originalAudio);
  const template = parseOpusWem(original.take);
  const wantsModel = Boolean(input.model) && input.originalLip.length > 0;
  // One ffmpeg run yields both the take and, when the model needs it, its samples.
  const { take, pcm } = wantsModel
    ? await encodeAudioToOpusWemWithPcm(input.audioPath, MIMIC_SAMPLE_RATE, { template })
    : { take: await encodeAudioToOpusWem(input.audioPath, { template }), pcm: null };
  const duration = opusWemDuration(parseOpusWem(take));
  const audio = buildW3SpeechAudio(take, duration, original.trailer);

  if (input.originalLip.length === 0)
    return { audio, lip: input.originalLip, duration, lipSource: 'none' };
  if (input.model && pcm) {
    const lip = await generateLipsyncBlockOffThread(
      { pcm, takeDuration: duration, model: input.model, template: input.originalLip },
      input.modelPath ?? null,
    );
    return { audio, lip, duration, lipSource: 'model' };
  }
  return {
    audio,
    lip: retimeLipsync(input.originalLip, duration + LIP_TAIL_SECONDS),
    duration,
    lipSource: 'retimed',
  };
};
