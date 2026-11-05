import path from 'node:path';
import { sha1Hex, sha1HexFile } from '../utils/hash';
import type { VortexInventoryFile } from './types';

/** sha1 of one file; the agent passes a cached one so multi-GB archives hash once. */
export type FileHasher = (absPath: string) => Promise<string>;

export const merkleContentHash = async (
  files: VortexInventoryFile[],
  hashFile: FileHasher = sha1HexFile,
): Promise<string> => {
  const sorted = [...files].sort((a, b) => a.relPath.localeCompare(b.relPath, 'en'));
  const lines: string[] = [];
  for (const file of sorted) {
    const digest = await hashFile(file.absPath);
    lines.push(`${file.relPath.replace(/\\/g, '/')}\0${digest}`);
  }
  return sha1Hex(lines.join('\n'));
};

export const toPosixRel = (from: string, to: string): string =>
  path.relative(from, to).replace(/\\/g, '/');
