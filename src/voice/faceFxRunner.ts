#!/usr/bin/env tsx
/**
 * Isolated FaceFXWrapper runner (no inherited console — avoids AttachConsole spam).
 * stdout: one JSON line { ok, lipPath, summary }
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execVoiceToolAsync } from './voiceExec';
import { encodeFaceFxDialogueText } from './faceFxText';

export type FaceFxRunnerResult = {
  ok: boolean;
  lipPath: string;
  summary: string;
};

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

const run = async (): Promise<void> => {
  const [game, fonixPath, wavPath, resampledPath, lipPath, faceFxExe, ...textParts] =
    process.argv.slice(2);
  if (!game || !fonixPath || !wavPath || !resampledPath || !lipPath || !faceFxExe) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        lipPath: lipPath ?? '',
        summary: 'faceFxRunner: missing arguments',
      } satisfies FaceFxRunnerResult),
    );
    process.exit(1);
    return;
  }

  const dialogueText = textParts.join(' ');
  if (fs.existsSync(`${lipPath}.resampled.wav`)) fs.unlinkSync(`${lipPath}.resampled.wav`);
  if (fs.existsSync(lipPath)) fs.unlinkSync(lipPath);

  let stdout = '';
  let stderr = '';
  try {
    ({ stdout, stderr } = await execVoiceToolAsync(faceFxExe, [
      faceFxGameType(game),
      'USEnglish',
      fonixPath,
      wavPath,
      resampledPath,
      lipPath,
      encodeFaceFxDialogueText(dialogueText),
    ]));
  } catch (err) {
    stderr = err instanceof Error ? err.message : String(err);
  }

  const ok = fs.existsSync(lipPath);
  const result: FaceFxRunnerResult = {
    ok,
    lipPath,
    summary: summarizeFaceFxOutput(stdout, stderr, lipPath),
  };
  process.stdout.write(JSON.stringify(result));
  process.exit(ok ? 0 : 1);
};

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1]!)).href;

if (isMain) {
  run().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      JSON.stringify({ ok: false, lipPath: '', summary: message } satisfies FaceFxRunnerResult),
    );
    process.exit(1);
  });
}
