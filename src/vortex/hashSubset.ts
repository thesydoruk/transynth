import path from 'node:path';
import { sha1Hex, sha1HexFile } from '../utils/hash';
import type { VortexInventoryFile } from './types';

export const merkleContentHash = async (files: VortexInventoryFile[]): Promise<string> => {
  const sorted = [...files].sort((a, b) => a.relPath.localeCompare(b.relPath, 'en'));
  const lines: string[] = [];
  for (const file of sorted) {
    const digest = await sha1HexFile(file.absPath);
    lines.push(`${file.relPath.replace(/\\/g, '/')}\0${digest}`);
  }
  return sha1Hex(lines.join('\n'));
};

export const toPosixRel = (from: string, to: string): string =>
  path.relative(from, to).replace(/\\/g, '/');
