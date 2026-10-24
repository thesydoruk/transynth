/**
 * Bethesda voice-clip rows: one physical take per speaker × INFO response.
 */
import { voiceSpeakerKey } from './speakerReference/grouping';
import { originFormidKey, originFromVoiceRelPath, splitOriginFormidKey } from './voiceOrigin';
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
  lineKey: string;
  variant: number;
  formidHex: string;
  /** Plugin that owns the line (lower-cased), from the take's folder. */
  originPlugin: string;
  stringId: number | null;
  relPath: string;
  sharedFromFormid: string | null;
};

/** 6-char FormID → 8-char hex used on INFO records (`005825` → `00005825`). */
export const padVoiceFormidHex = (lineKey: string): string =>
  lineKey.toUpperCase().padStart(8, '0');

const clipSpeakerKey = (entry: VoiceFileEntry, voiceRootRel: string): string =>
  voiceSpeakerKey(entry, voiceRootRel) || speakerFromRelPath(entry.relPath);

const clipOrigin = (entry: VoiceFileEntry): string =>
  entry.originPlugin ?? originFromVoiceRelPath(entry.relPath) ?? '';

const resolveClipString = (
  origin: string,
  lineKey: string,
  variant: number,
  stringsByKey: Map<string, VoiceClipStringRef>,
  sharedFrom: Map<string, string>,
): { ref: VoiceClipStringRef | undefined; sharedFromFormid: string | null } => {
  const own = stringsByKey.get(voiceTranslationMapKey(lineKey, variant, origin));
  const shared = sharedFrom.get(originFormidKey(origin, lineKey));
  const sharedTarget = shared ? splitOriginFormidKey(shared) : null;
  const sharedFromFormid = sharedTarget?.lineKey ?? null;
  if (own) return { ref: own, sharedFromFormid };
  if (!sharedTarget) return { ref: undefined, sharedFromFormid: null };
  return {
    ref: stringsByKey.get(
      voiceTranslationMapKey(sharedTarget.lineKey, variant, sharedTarget.origin ?? origin),
    ),
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
    const originPlugin = clipOrigin(entry);
    const lineKey = entry.lineKey.toUpperCase();
    const variant = entry.variant;
    const takeKey = `${originPlugin}\0${speakerKey.toLowerCase()}\0${lineKey}\0${variant}`;
    if (seen.has(takeKey)) continue;
    seen.add(takeKey);

    const { ref, sharedFromFormid } = resolveClipString(
      originPlugin,
      lineKey,
      variant,
      stringsByKey,
      sharedFrom,
    );
    rows.push({
      speakerKey,
      lineKey,
      variant,
      formidHex: padVoiceFormidHex(lineKey),
      originPlugin,
      stringId: ref?.stringId ?? null,
      relPath: normalizeRelPath(entry.relPath),
      sharedFromFormid,
    });
  }

  return rows;
};
