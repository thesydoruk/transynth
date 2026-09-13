import { formatVortexVersionTail, parseVortexModFolder } from '../utils/vortexFolder';

const HASH_PREFIX = 12;

/** Human version for a Vortex unit: folder / game release / short content hash. */
export const inferModVersionLabel = (opts: {
  sourceFolder?: string | null;
  channel: 'mods' | 'game';
  gameReleaseLabel?: string | null;
  contentHash?: string | null;
}): string => {
  if (opts.channel === 'game' && opts.gameReleaseLabel?.trim()) {
    return opts.gameReleaseLabel.trim();
  }
  const folder = opts.sourceFolder?.trim() || '';
  if (folder) {
    const parsed = parseVortexModFolder(folder);
    if (parsed?.version) return parsed.version;
    const loose = folder.match(/\b(\d+\.\d+(?:\.\d+)*[a-zA-Z]?)\b/);
    if (loose?.[1]) return formatVortexVersionTail(loose[1]);
  }
  const hash = opts.contentHash?.trim() || '';
  return hash ? hash.slice(0, HASH_PREFIX) : 'unknown';
};
