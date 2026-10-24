/** Pure pairing of dest lines with donor takes (text + speaker only; file hash is later). */

export type ReuseVoiceLineKey = {
  speakerKey: string;
  /** Lower-cased plugin folder under Sound/Voice; '' when unknown. */
  originPlugin: string;
  sourceText: string;
  translation: string;
  /** Transcript of the reference clip when it is not `sourceText` (see `VoiceTake`). */
  speakerSource?: string;
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
  `${line.speakerKey.toLowerCase()}\0${line.originPlugin}\0${line.sourceText}\0${line.translation}`;

export const isReusableVoiceText = (value: string | null | undefined): value is string =>
  Boolean(value && value.trim());

/**
 * Pair dest lines that still need audio with a donor take that has the same
 * speaker, exact source text, and exact translation. File-hash checks happen
 * after this, so the matcher stays pure.
 *
 * `expectedVersion` gives the TTS payload version the donor's take would carry
 * had it been made from the text it now has. A donor whose stored stamp differs
 * was synthesized from an older translation and is stale: its audio says the
 * old words even though its text matches, so it must not be copied. (A base-game
 * line once got Depravity's take that still said the pre-review wording.)
 */
export const matchReusableVoiceLines = (
  dest: ReuseVoiceDestLine[],
  sources: ReuseVoiceSourceLine[],
  expectedVersion?: (line: ReuseVoiceLineKey) => string,
): ReuseVoiceMatch[] => {
  const byKey = new Map<string, ReuseVoiceSourceLine[]>();
  for (const source of sources) {
    if (!isReusableVoiceText(source.sourceText) || !isReusableVoiceText(source.translation)) {
      continue;
    }
    if (expectedVersion && source.ttsTextVersion !== expectedVersion(source)) continue;
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
