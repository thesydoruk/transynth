/**
 * Cached lockit scan for one language folder.
 *
 * Both the wav↔text index and voice-file discovery need the same thing — every
 * spoken `.po` row of the pack, in file order — and the pack is tens of
 * megabytes of gettext. Scanning it once per folder keeps opening the voice tab
 * from re-reading the whole lockit.
 */
import path from 'node:path';
import { listPoFilesInDir } from '../packLayout';
import { scanDiscoPoSpokenLines, type DiscoPoSpokenLine } from './poVoiceMeta';

const SCAN_TTL_MS = 5 * 60_000;

type CacheEntry = {
  scannedAt: number;
  lines: DiscoPoSpokenLine[];
  conversations: Set<string>;
};

const cache = new Map<string, CacheEntry>();

const scan = (langFolderAbs: string): CacheEntry => {
  const lines = listPoFilesInDir(langFolderAbs).flatMap((poPath) => scanDiscoPoSpokenLines(poPath));
  return {
    scannedAt: Date.now(),
    lines,
    conversations: new Set(lines.map((line) => line.conversation).filter(Boolean)),
  };
};

const entryFor = (langFolderAbs: string): CacheEntry => {
  const key = path.resolve(langFolderAbs);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.scannedAt < SCAN_TTL_MS) return hit;
  const fresh = scan(langFolderAbs);
  cache.set(key, fresh);
  return fresh;
};

/** Every `Dialogue Text` / `AlternateN` row of a language folder, in file order. */
export const getDiscoSpokenPoLines = (langFolderAbs: string): DiscoPoSpokenLine[] =>
  entryFor(langFolderAbs).lines;

/**
 * Conversation titles in wav-name spelling (`WHIRLING F2  TEQUILA DOOR`).
 * A wav whose name carries none of these is not a dialogue take.
 */
export const getDiscoConversationNames = (langFolderAbs: string): ReadonlySet<string> =>
  entryFor(langFolderAbs).conversations;

/** Drop cached scans (tests / after pack changes). */
export const invalidateDiscoSpokenPoLines = (langFolderAbs?: string): void => {
  if (!langFolderAbs) {
    cache.clear();
    return;
  }
  cache.delete(path.resolve(langFolderAbs));
};
