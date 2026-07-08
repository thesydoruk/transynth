import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { GameType } from '../types';
import { log } from '../logger';
import { ensureDir } from '../utils/file';
import { resolveFaceFxWrapperPath, resolveFonixDataPath } from './voiceToolPaths';
import type { FaceFxRunnerResult } from './faceFxRunner';

export { encodeFaceFxDialogueText } from './faceFxText';

const tsxCliPath = (): string => path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

const faceFxRunnerPath = (): string => path.join(process.cwd(), 'src', 'voice', 'faceFxRunner.ts');

const spawnFaceFxRunner = (
  game: GameType,
  fonixPath: string,
  wavPath: string,
  resampledPath: string,
  lipPath: string,
  dialogueText: string,
): Promise<FaceFxRunnerResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        tsxCliPath(),
        faceFxRunnerPath(),
        game,
        fonixPath,
        wavPath,
        resampledPath,
        lipPath,
        resolveFaceFxWrapperPath(),
        dialogueText,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const line = stdout.trim().split(/\r?\n/).find(Boolean);
      if (line) {
        try {
          const parsed = JSON.parse(line) as FaceFxRunnerResult;
          resolve(parsed);
          return;
        } catch {
          // fall through
        }
      }
      reject(
        new Error(
          code === 0
            ? 'FaceFX runner returned no result'
            : `FaceFX runner failed (${code ?? '?'}): ${stderr.trim() || stdout.trim() || 'unknown error'}`,
        ),
      );
    });
  });

/**
 * Generate a fresh LIP file from synthesized dialogue audio and translated text.
 * FaceFX runs in an isolated subprocess so its console attach does not flood logs.
 */
export const generateLipFile = async (
  game: GameType,
  sourceWavPath: string,
  lipPath: string,
  dialogueText: string,
): Promise<void> => {
  ensureDir(path.dirname(lipPath));
  const resampledPath = `${lipPath}.resampled.wav`;
  if (fs.existsSync(resampledPath)) fs.unlinkSync(resampledPath);
  if (fs.existsSync(lipPath)) fs.unlinkSync(lipPath);

  const result = await spawnFaceFxRunner(
    game,
    resolveFonixDataPath(),
    sourceWavPath,
    resampledPath,
    lipPath,
    dialogueText,
  );

  if (!result.ok || !fs.existsSync(lipPath)) {
    throw new Error(`FaceFX: ${result.summary}`);
  }

  log.debug(`FaceFX ${result.summary}`);
};
