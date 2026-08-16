import type { Tx } from '../db';
import type { TtsSynthesisParams } from '../tts/ttsSynthesisParams';
import { syncTtsPoolLimit } from '../tts/ttsRequestPool';
import { getAllProjectSettings, type ProjectSettings } from '../web/services/projectSettings';
import type { TtsReferenceMode } from './voiceToolPaths';

/** Map persisted project settings to TTS reference clip mode. */
export const voiceReferenceModeFromProjectSettings = (
  settings: ProjectSettings,
): TtsReferenceMode => (settings['voice.line_reference'] ? 'line' : 'speaker');

/** Map persisted project settings to Fish Speech sampling + xtts-engine match flags. */
export const voiceSynthesisFromProjectSettings = (
  settings: ProjectSettings,
): TtsSynthesisParams => ({
  temperature: settings['voice.temperature'],
  repetitionPenalty: settings['voice.repetition_penalty'],
  topP: settings['voice.top_p'],
  matchLoudness: settings['voice.match_loudness'],
  matchTiming: settings['voice.match_timing'],
});

/** Push Fish Speech concurrency limit from project settings into the global pool. */
export const syncTtsPoolFromProjectSettings = (settings: ProjectSettings): void => {
  syncTtsPoolLimit(settings['voice.tts_max_parallel_fish_speech']);
};

/** Fish Speech concurrency limit from project settings. */
export const voiceTtsMaxParallelFromProjectSettings = (settings: ProjectSettings): number =>
  settings['voice.tts_max_parallel_fish_speech'];

/** Load voice synthesis settings from project_settings. */
export const loadVoiceProjectSettings = async (
  db: Tx,
): Promise<{
  referenceMode: TtsReferenceMode;
  synthesis: TtsSynthesisParams;
  ttsMaxParallel: number;
}> => {
  const settings = await getAllProjectSettings(db);
  syncTtsPoolFromProjectSettings(settings);
  return {
    referenceMode: voiceReferenceModeFromProjectSettings(settings),
    synthesis: voiceSynthesisFromProjectSettings(settings),
    ttsMaxParallel: settings['voice.tts_max_parallel_fish_speech'],
  };
};
