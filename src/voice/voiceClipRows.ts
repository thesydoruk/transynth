/**
 * Bethesda voice-clip rows: one physical take per speaker × INFO response.
 */
import { voiceSpeakerKey } from './speakerReference/grouping';
import { voiceTranslationMapKey } from './voiceTextRows';
import type { VoiceFileEntry } from './discoverVoiceFiles';

const normalizeRelPath = (relPath: string): string =>
  relPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

const speakerFromRelPath = (relPath: string): string => {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? '') : '';
};

export type VoiceClipStringRef = {
  stringId: number;
  formidHex: string;
};

export type VoiceClipRow = {
  speakerKey: string;
  formidLower6: string;
  variant: number;
  formidHex: string;
  stringId: number | null;
  relPath: string;
  sharedFromFormid: string | null;
};

/** 6-char FormID → 8-char hex used on INFO records (`005825` → `00005825`). */
export const padVoiceFormidHex = (formidLower6: string): string =>
  formidLower6.toUpperCase().padStart(8, '0');

const clipSpeakerKey = (entry: VoiceFileEntry, voiceRootRel: string): string =>
  voiceSpeakerKey(entry, voiceRootRel) || speakerFromRelPath(entry.relPath);

const resolveClipString = (
  formidLower6: string,
  variant: number,
  stringsByKey: Map<string, VoiceClipStringRef>,
  sharedFrom: Map<string, string>,
): { ref: VoiceClipStringRef | undefined; sharedFromFormid: string | null } => {
  const own = stringsByKey.get(voiceTranslationMapKey(formidLower6, variant));
  const sharedFromFormid = sharedFrom.get(formidLower6) ?? null;
  if (own) return { ref: own, sharedFromFormid };
  if (!sharedFromFormid) return { ref: undefined, sharedFromFormid: null };
  return {
    ref: stringsByKey.get(voiceTranslationMapKey(sharedFromFormid, variant)),
    sharedFromFormid,
  };
};

/**
 * Join discovered `.fuz`/`.wav` files to INFO strings.
 *
 * Same FormID + variant in two speaker folders (Nate/Nora, shared NPC lines)
 * become two rows. DNAM aliases keep the file FormID and borrow `string_id`.
 */
export const buildVoiceClipRows = (
  files: VoiceFileEntry[],
  voiceRootRel: string,
  stringsByKey: Map<string, VoiceClipStringRef>,
  sharedFrom: Map<string, string>,
): VoiceClipRow[] => {
  const rows: VoiceClipRow[] = [];
  const seen = new Set<string>();

  for (const entry of files) {
    const speakerKey = clipSpeakerKey(entry, voiceRootRel);
    const formidLower6 = entry.formidLower6.toUpperCase();
    const variant = entry.variant;
    const takeKey = `${speakerKey.toLowerCase()}\0${formidLower6}\0${variant}`;
    if (seen.has(takeKey)) continue;
    seen.add(takeKey);

    const { ref, sharedFromFormid } = resolveClipString(
      formidLower6,
      variant,
      stringsByKey,
      sharedFrom,
    );
    rows.push({
      speakerKey,
      formidLower6,
      variant,
      formidHex: padVoiceFormidHex(formidLower6),
      stringId: ref?.stringId ?? null,
      relPath: normalizeRelPath(entry.relPath),
      sharedFromFormid,
    });
  }

  return rows;
};
