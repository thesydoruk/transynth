import fs from 'node:fs';
import path from 'node:path';
import { convertToFaceFxWav } from '../ffmpegAudio';
import { execVoiceToolAsync } from '../voiceExec';
import { encodeFaceFxDialogueText, sanitizeFaceFxDialogueText } from './text';

export type FaceFxLipRequest = {
  game: string;
  fonixPath: string;
  wavPath: string;
  resampledPath: string;
  lipPath: string;
  faceFxExe: string;
  dialogueText: string;
};

export type FaceFxLipResult = {
  ok: boolean;
  lipPath: string;
  summary: string;
};

/** Max wall time for one FaceFXWrapper run (Wine on Linux can hang indefinitely). */
export const FACEFX_TIMEOUT_MS = 120_000;

const faceFxGameType = (game: string): string => {
  switch (game) {
    case 'fo4':
    case 'fo76':
      return 'Fallout4';
    case 'fo3':
      return 'Fallout3';
    case 'fnv':
      return 'FalloutNV';
    default:
      return 'Skyrim';
  }
};

export const summarizeFaceFxOutput = (stdout: string, stderr: string, lipPath: string): string => {
  const log = `${stdout}\n${stderr}`.trim();
  if (fs.existsSync(lipPath)) {
    const size = fs.statSync(lipPath).size;
    return `LIP ${path.basename(lipPath)} (${size} B)`;
  }
  const line =
    log
      .split(/\r?\n/)
      .map((entry) => entry.replace(/^\[[^\]]+\]\s*/, '').trim())
      .find((entry) => /failed|error|unable/i.test(entry)) ??
    log
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean);
  return line ? line.slice(0, 160) : 'FaceFX did not create LIP';
};

/** Resample the dialogue WAV and run FaceFXWrapper to produce the `.lip` file. */
export const runFaceFxLip = async (request: FaceFxLipRequest): Promise<FaceFxLipResult> => {
  const { game, fonixPath, wavPath, resampledPath, lipPath, faceFxExe, dialogueText } = request;

  if (fs.existsSync(resampledPath)) fs.unlinkSync(resampledPath);
  if (fs.existsSync(lipPath)) fs.unlinkSync(lipPath);

  const dialogueArg = encodeFaceFxDialogueText(sanitizeFaceFxDialogueText(dialogueText));
  const faceFxArgs =
    process.platform === 'win32'
      ? [faceFxGameType(game), 'USEnglish', fonixPath, wavPath, resampledPath, lipPath, dialogueArg]
      : [faceFxGameType(game), 'USEnglish', fonixPath, resampledPath, lipPath, dialogueArg];

  let stdout = '';
  let stderr = '';
  try {
    if (process.platform !== 'win32') {
      await convertToFaceFxWav(wavPath, resampledPath);
    }
    ({ stdout, stderr } = await execVoiceToolAsync(faceFxExe, faceFxArgs, {
      timeoutMs: FACEFX_TIMEOUT_MS,
    }));
  } catch (err) {
    stderr = err instanceof Error ? err.message : String(err);
  }

  return {
    ok: fs.existsSync(lipPath),
    lipPath,
    summary: summarizeFaceFxOutput(stdout, stderr, lipPath),
  };
};
