import type { Tx } from '../db';
import { syncTtsPoolLimit } from '../tts/ttsRequestPool';
import { getAllProjectSettings } from '../web/services/projectSettings';
import type { TtsReferenceMode } from './voiceToolPaths';

/** Map persisted project settings to TTS reference clip mode. */
export const voiceReferenceModeFromProjectSettings = (
  settings: Awaited<ReturnType<typeof getAllProjectSettings>>,
): TtsReferenceMode => (settings['voice.line_reference'] ? 'line' : 'speaker');

/** Push Fish Speech concurrency limit from project settings into the global pool. */
export const syncTtsPoolFromProjectSettings = (
  settings: Awaited<ReturnType<typeof getAllProjectSettings>>,
): void => {
  syncTtsPoolLimit(settings['voice.tts_max_parallel_fish_speech']);
};

/** Fish Speech concurrency limit from project settings. */
export const voiceTtsMaxParallelFromProjectSettings = (
  settings: Awaited<ReturnType<typeof getAllProjectSettings>>,
): number => settings['voice.tts_max_parallel_fish_speech'];

/** Load voice synthesis settings from project_settings. */
export const loadVoiceProjectSettings = async (
  db: Tx,
): Promise<{
  referenceMode: TtsReferenceMode;
  ttsMaxParallel: number;
}> => {
  const settings = await getAllProjectSettings(db);
  syncTtsPoolFromProjectSettings(settings);
  return {
    referenceMode: voiceReferenceModeFromProjectSettings(settings),
    ttsMaxParallel: settings['voice.tts_max_parallel_fish_speech'],
  };
};
