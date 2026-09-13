import fs from 'node:fs';
import path from 'node:path';
import { unpack } from 'msgpackr';
import { normalizeLangpackZipPath } from '../web/export/langpackMerge';

export type VortexDeployedFile = {
  relPath: string;
  sourceFolder: string;
};

export type VortexDeployment = {
  method: string | null;
  files: VortexDeployedFile[];
  source: string;
};

type LooseRecord = Record<string, unknown>;

const asRecord = (value: unknown): LooseRecord | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as LooseRecord) : null;

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

const normalizeRelPath = (raw: string): string => normalizeLangpackZipPath(raw);

export const parseVortexDeployment = (raw: unknown): VortexDeployedFile[] => {
  const root = asRecord(raw);
  const files = root?.files;
  if (!Array.isArray(files)) return [];
  const out: VortexDeployedFile[] = [];
  const seen = new Set<string>();
  for (const row of files) {
    const rec = asRecord(row);
    if (!rec) continue;
    const relPath = asString(rec.relPath) ?? asString(rec.relpath);
    const sourceFolder = asString(rec.source);
    if (!relPath || !sourceFolder) continue;
    const name = normalizeRelPath(relPath);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ relPath: name, sourceFolder });
  }
  return out;
};

const DEPLOYMENT_NAMES = ['vortex.deployment.msgpack', 'vortex.deployment.json'] as const;

export const readVortexDeploymentFile = (filePath: string): VortexDeployedFile[] => {
  const buf = fs.readFileSync(filePath);
  if (filePath.toLowerCase().endsWith('.json')) {
    return parseVortexDeployment(JSON.parse(buf.toString('utf8')));
  }
  return parseVortexDeployment(unpack(buf));
};

export const discoverVortexDeployment = (stagingPath: string): VortexDeployment | null => {
  for (const name of DEPLOYMENT_NAMES) {
    const abs = path.join(stagingPath, name);
    if (!fs.existsSync(abs)) continue;
    const files = readVortexDeploymentFile(abs);
    if (files.length === 0) continue;
    let method: string | null = null;
    try {
      const raw = name.endsWith('.json')
        ? JSON.parse(fs.readFileSync(abs, 'utf8'))
        : unpack(fs.readFileSync(abs));
      method = asString(asRecord(raw)?.deploymentMethod);
    } catch {
      method = null;
    }
    return { method, files, source: abs };
  }
  return null;
};
