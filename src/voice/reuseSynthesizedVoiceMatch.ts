/** Pure pairing of dest lines with donor takes (text + speaker only; file hash is later). */

export type ReuseVoiceLineKey = {
  speakerKey: string;
  sourceText: string;
  translation: string;
};

export type ReuseVoiceDestLine = ReuseVoiceLineKey & {
  destRelPath: string;
  sourceAbsPath: string;
  sourceRelPath: string;
  hasLocalized: boolean;
  lineKey: string;
  variant: number;
};

export type ReuseVoiceSourceLine = ReuseVoiceLineKey & {
  localizedAbsPath: string;
  sourceAbsPath: string;
  sourceRelPath: string;
  lineKey: string;
  variant: number;
  ttsTextVersion: string | null;
  voiceSimilarity: number | null;
};

export type ReuseVoiceMatch = {
  dest: ReuseVoiceDestLine;
  source: ReuseVoiceSourceLine;
};

const reuseVoiceLineKey = (line: ReuseVoiceLineKey): string =>
  `${line.speakerKey.toLowerCase()}\0${line.sourceText}\0${line.translation}`;

export const isReusableVoiceText = (value: string | null | undefined): value is string =>
  Boolean(value && value.trim());

/**
 * Pair dest lines that still need audio with a donor take that has the same
 * speaker, exact source text, and exact translation. File-hash checks happen
 * after this, so the matcher stays pure.
 */
export const matchReusableVoiceLines = (
  dest: ReuseVoiceDestLine[],
  sources: ReuseVoiceSourceLine[],
): ReuseVoiceMatch[] => {
  const byKey = new Map<string, ReuseVoiceSourceLine[]>();
  for (const source of sources) {
    if (!isReusableVoiceText(source.sourceText) || !isReusableVoiceText(source.translation)) {
      continue;
    }
    const key = reuseVoiceLineKey(source);
    const list = byKey.get(key) ?? [];
    list.push(source);
    byKey.set(key, list);
  }

  const matches: ReuseVoiceMatch[] = [];
  for (const destLine of dest) {
    if (destLine.hasLocalized) continue;
    if (!isReusableVoiceText(destLine.sourceText) || !isReusableVoiceText(destLine.translation)) {
      continue;
    }
    const candidates = byKey.get(reuseVoiceLineKey(destLine));
    if (!candidates?.length) continue;
    matches.push({ dest: destLine, source: candidates[0]! });
  }
  return matches;
};
