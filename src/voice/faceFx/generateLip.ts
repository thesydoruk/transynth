import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { GameType } from '../../types';
import { log } from '../../logger';
import { ensureDir } from '../../utils/file';
import { resolveFaceFxWrapperPath, resolveFonixDataPath } from '../voiceToolPaths';
import { FACEFX_TIMEOUT_MS, type FaceFxLipRequest, type FaceFxLipResult } from './lipCore';
import { generateLipViaRemote, resolveBethesdaToolsUrl } from '../bethesdaTools';

const tsxCliPath = (): string => path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');

const faceFxRunnerPath = (): string =>
  path.join(process.cwd(), 'src', 'voice', 'faceFx', 'runner.ts');

/**
 * Windows-only: FaceFXWrapper attaches to the parent console and floods our logs,
 * so it runs in a throwaway Node process. Linux uses bethesda-tools.
 */
const spawnFaceFxRunner = (request: FaceFxLipRequest): Promise<FaceFxLipResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        tsxCliPath(),
        faceFxRunnerPath(),
        request.game,
        request.fonixPath,
        request.wavPath,
        request.resampledPath,
        request.lipPath,
        request.faceFxExe,
        request.dialogueText,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, FACEFX_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      const line = stdout.trim().split(/\r?\n/).find(Boolean);
      if (line) {
        try {
          const parsed = JSON.parse(line) as FaceFxLipResult;
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

/** Generate a fresh LIP file from synthesized dialogue audio and translated text. */
export const generateLipFile = async (
  game: GameType,
  sourceWavPath: string,
  lipPath: string,
  dialogueText: string,
): Promise<void> => {
  ensureDir(path.dirname(lipPath));

  const remoteUrl = resolveBethesdaToolsUrl();
  if (remoteUrl) {
    await generateLipViaRemote(remoteUrl, game, sourceWavPath, lipPath, dialogueText);
    log.debug(`FaceFX remote ${path.basename(lipPath)}`);
    return;
  }

  if (process.platform !== 'win32') {
    throw new Error('BETHESDA_TOOLS_URL is not set');
  }

  const request: FaceFxLipRequest = {
    game,
    fonixPath: resolveFonixDataPath(),
    wavPath: sourceWavPath,
    resampledPath: `${lipPath}.resampled.wav`,
    lipPath,
    faceFxExe: resolveFaceFxWrapperPath(),
    dialogueText,
  };

  const result = await spawnFaceFxRunner(request);

  if (!result.ok || !fs.existsSync(lipPath)) {
    throw new Error(`FaceFX: ${result.summary}`);
  }

  log.debug(`FaceFX ${result.summary}`);
};
