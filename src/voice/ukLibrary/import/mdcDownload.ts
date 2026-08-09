import fs from 'node:fs';
import path from 'node:path';
import { request } from 'undici';
import { log } from '../../../logger';
import { downloadFile } from '../../../tools/archiveUtils';
import { ensureDir } from '../../../utils/file';
import { ukVoiceCacheCommonVoiceDir } from './cachePaths';
import { extractTarGz } from './extractTarGz';

/** Common Voice Scripted Speech 26.0 — Ukrainian (MDC). */
export const MDC_CV26_UK_DATASET_ID = 'cmqinqaqp00wunq07w9oyei38';

type MdcDownloadResponse = {
  downloadUrl?: string;
  filename?: string;
  sizeBytes?: string | number;
};

const markerPath = (dir: string): string => path.join(dir, '.cache-complete');

/** True when validated.tsv is present under the CV cache tree. */
export const isCommonVoiceCacheReady = (dir: string = ukVoiceCacheCommonVoiceDir()): boolean => {
  if (fs.existsSync(markerPath(dir))) return true;
  return findValidatedTsv(dir) != null;
};

export const findValidatedTsv = (rootDir: string): string | null => {
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === 'validated.tsv') return full;
    }
  }
  return null;
};

/**
 * Download + extract CV26-UK via Mozilla Data Collective API.
 * Requires MDC_API_TOKEN and prior terms acceptance in the MDC web UI.
 * If the corpus is already extracted under the cache dir, this is a no-op.
 */
export const cacheCommonVoice26Uk = async (): Promise<string> => {
  const outDir = ukVoiceCacheCommonVoiceDir();
  if (isCommonVoiceCacheReady(outDir)) {
    log.info(`common_voice cache ready: ${outDir}`);
    return outDir;
  }

  const token = process.env.MDC_API_TOKEN?.trim();
  if (!token) {
    throw new Error(
      `Common Voice cache missing at ${outDir}. Either:\n` +
        `  1) Set MDC_API_TOKEN (after accepting terms at mozilladatacollective.com), or\n` +
        `  2) Manually extract CV26-UK under that directory (must include validated.tsv + clips/).`,
    );
  }

  log.info(`common_voice: requesting MDC download for ${MDC_CV26_UK_DATASET_ID}`);
  const res = await request(
    `https://mozilladatacollective.com/api/datasets/${MDC_CV26_UK_DATASET_ID}/download`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    },
  );
  if (res.statusCode >= 400) {
    const body = await res.body.text();
    throw new Error(`MDC download API HTTP ${res.statusCode}: ${body.slice(0, 400)}`);
  }
  const payload = (await res.body.json()) as MdcDownloadResponse;
  if (!payload.downloadUrl) throw new Error('MDC download API returned no downloadUrl');

  const archiveName = payload.filename ?? 'common-voice-26-uk.tar.gz';
  const archivePath = path.join(outDir, archiveName);
  ensureDir(outDir);
  if (!fs.existsSync(archivePath)) {
    log.info(`common_voice: downloading ${archiveName} → ${archivePath}`);
    await downloadFile(payload.downloadUrl, archivePath);
  }

  log.info(`common_voice: extracting ${archivePath}`);
  await extractTarGz(archivePath, outDir);
  if (!findValidatedTsv(outDir)) {
    throw new Error(`Extracted CV archive but validated.tsv not found under ${outDir}`);
  }
  fs.writeFileSync(
    markerPath(outDir),
    JSON.stringify({ datasetId: MDC_CV26_UK_DATASET_ID, at: new Date().toISOString() }),
  );
  log.info(`common_voice: cache complete → ${outDir}`);
  return outDir;
};
