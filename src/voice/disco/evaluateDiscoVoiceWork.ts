import fs from 'node:fs';
import path from 'node:path';
import { toDiskPath } from '../../modImport';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import {
  lookupVoiceTranslation,
  voiceTranslationMapKey,
  type VoiceTranslationRow,
} from '../loadVoiceTranslations';
import {
  canSynthesizeVoiceLine,
  prepareVoiceTtsText,
  type PrepareVoiceTtsTextResult,
} from '../prepareVoiceTtsText';
import { lookupVoiceSynthesisVersion } from '../voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from '../voiceTtsPayloadVersion';
import { discoSpeakerKeyFromStem, discoVoiceSpeakerKey } from './discoverDiscoVoiceFiles';
import { resolveDiscoSpokenRowText } from './resolveDiscoSpokenRow';
import { outputLocalizedWavRelPath } from './voicePaths';

export type DiscoVoiceWorkItem = {
  row: VoiceTranslationRow;
  prepared: Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>;
};

export type DiscoVoiceWorkFilter = {
  onlyKeys?: ReadonlySet<string>;
  speakerFilter: string;
  tgtLang: string;
  localizeDir: string;
  storedVersions: Map<string, string>;
  forceAll: boolean;
  /** Count / progress use cache-only ASR so they stay cheap and stay in sync. */
  transcribe: boolean;
};

/**
 * Same eligibility as the job total: synthesizable, and (unless force-all)
 * missing or stale. Shared by the pre-pass count and the synthesis loop so
 * progress does not increment for clips that are already current.
 */
export const evaluateDiscoVoiceWork = async (
  entry: VoiceFileEntry,
  translations: Map<string, VoiceTranslationRow>,
  filter: DiscoVoiceWorkFilter,
): Promise<DiscoVoiceWorkItem | null> => {
  const stem = path.basename(entry.fileName, path.extname(entry.fileName));
  const entryKey = voiceTranslationMapKey(entry.formidLower6, entry.variant);
  if (filter.onlyKeys && !filter.onlyKeys.has(entryKey)) {
    return null;
  }
  if (filter.speakerFilter && discoSpeakerKeyFromStem(stem) !== filter.speakerFilter) return null;
  const row = lookupVoiceTranslation(translations, entry.formidLower6, entry.variant);
  if (!row || !canSynthesizeVoiceLine(row.source, row.translation, row.edid, 'disco')) return null;
  const spoken = await resolveDiscoSpokenRowText(row, entry.absolutePath, {
    transcribe: filter.transcribe,
  });
  const prepared = prepareVoiceTtsText({
    lineSource: spoken.source,
    translation: spoken.translation,
    speakerSource: spoken.source,
    edid: row.edid,
    markup: 'disco',
  });
  if (prepared.action !== 'synthesize') return null;
  if (!filter.forceAll) {
    const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, filter.tgtLang);
    const wavDest = toDiskPath(filter.localizeDir, outputLocalizedWavRelPath(entry));
    const storedVersion = lookupVoiceSynthesisVersion(
      filter.storedVersions,
      discoVoiceSpeakerKey(entry),
      entry.formidLower6,
      entry.variant,
    );
    if (isVoiceSynthesisCurrent(storedVersion, payloadVersion, fs.existsSync(wavDest))) {
      return null;
    }
  }
  return { row, prepared };
};
