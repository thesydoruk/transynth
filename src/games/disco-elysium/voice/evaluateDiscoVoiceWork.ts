import { DISCO_VOICE_MARKUP } from './markup';
import fs from 'node:fs';
import path from 'node:path';
import { toDiskPath } from '../../../modImport';
import type { VoiceFileEntry } from '../../../voice/discoverVoiceFiles';
import {
  lookupVoiceTranslation,
  voiceTranslationMapKey,
  type VoiceTranslationRow,
} from '../../../voice/loadVoiceTranslations';
import {
  canSynthesizeVoiceLine,
  prepareVoiceTtsText,
  type PrepareVoiceTtsTextResult,
} from '../../../voice/prepareVoiceTtsText';
import { lookupVoiceSynthesisVersion } from '../../../voice/voiceSynthesisState';
import { voiceTtsPayloadVersionFromPrepared } from '../../../voice/voiceTtsPayloadVersion';
import { voiceTakeNeedsWork, type VoiceResynthContext } from '../../../voice/voiceResynth';
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
  /** Set for a `low-similarity` job. */
  resynth?: VoiceResynthContext;
  /** Count / progress use cache-only ASR so they stay cheap and stay in sync. */
  transcribe: boolean;
};

/**
 * Same eligibility as the job total: synthesizable, and due in the job's scope
 * (see `voiceTakeNeedsWork`). Shared by the pre-pass count and the synthesis
 * loop so progress does not increment for clips the job leaves alone.
 */
export const evaluateDiscoVoiceWork = async (
  entry: VoiceFileEntry,
  translations: Map<string, VoiceTranslationRow>,
  filter: DiscoVoiceWorkFilter,
): Promise<DiscoVoiceWorkItem | null> => {
  const stem = path.basename(entry.fileName, path.extname(entry.fileName));
  const entryKey = voiceTranslationMapKey(entry.lineKey, entry.variant);
  if (filter.onlyKeys && !filter.onlyKeys.has(entryKey)) {
    return null;
  }
  if (filter.speakerFilter && discoSpeakerKeyFromStem(stem) !== filter.speakerFilter) return null;
  const row = lookupVoiceTranslation(translations, entry.lineKey, entry.variant);
  if (!row || !canSynthesizeVoiceLine(row.source, row.translation, row.edid, DISCO_VOICE_MARKUP))
    return null;
  const spoken = await resolveDiscoSpokenRowText(row, entry.absolutePath, {
    transcribe: filter.transcribe,
  });
  const prepared = prepareVoiceTtsText({
    lineSource: spoken.source,
    translation: spoken.translation,
    speakerSource: spoken.source,
    edid: row.edid,
    markup: DISCO_VOICE_MARKUP,
  });
  if (prepared.action !== 'synthesize') return null;
  const speakerKey = discoVoiceSpeakerKey(entry);
  const wavDest = toDiskPath(filter.localizeDir, outputLocalizedWavRelPath(entry));
  const due = voiceTakeNeedsWork({
    force: filter.forceAll,
    resynth: filter.resynth,
    speakerKey,
    lineKey: entry.lineKey,
    variant: entry.variant,
    storedVersion: lookupVoiceSynthesisVersion(
      filter.storedVersions,
      speakerKey,
      entry.lineKey,
      entry.variant,
    ),
    payloadVersion: voiceTtsPayloadVersionFromPrepared(prepared, filter.tgtLang),
    fileExists: fs.existsSync(wavDest),
  });
  if (!due) return null;
  return { row, prepared };
};
