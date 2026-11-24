import fs from 'node:fs';
import { postBethesdaToolBinary } from './client';

/** Name the service accepts for the WAV, animation and group inside the `.ffxanim`. */
const FFXANIM_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;

/**
 * The animation name for a target file: its base name (a take's WEM id such as
 * `00ae4a02`, as the Creation Kit names it), or none and the service's default when
 * the base name has characters the service refuses.
 */
export const ffxanimNameFor = (ffxanimPath: string): string | undefined => {
  const fileName = ffxanimPath.split(/[\\/]/).pop() ?? '';
  const base = fileName.replace(/\.ffxanim$/i, '');
  return FFXANIM_NAME_RE.test(base) ? base : undefined;
};

/**
 * Raw dialogue: the service strips `[tags]` and respells Ukrainian for Fonix, and
 * falls back to an audio-only analysis when nothing readable is left.
 */
export const generateFfxanimViaRemote = async (
  baseUrl: string,
  game: string,
  sourceWavPath: string,
  ffxanimPath: string,
  dialogueText: string,
  actor: 'male' | 'female',
): Promise<void> => {
  const wav = fs.readFileSync(sourceWavPath);
  const ffxanim = await postBethesdaToolBinary(baseUrl, '/v1/ffxanim', {
    game,
    text: dialogueText,
    actor,
    name: ffxanimNameFor(ffxanimPath),
    wav: wav.toString('base64'),
  });
  fs.writeFileSync(ffxanimPath, ffxanim);
};
