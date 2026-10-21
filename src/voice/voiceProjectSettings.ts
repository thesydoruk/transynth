import type { Tx } from '../db';
import type { TtsSynthesisParams } from '../tts/ttsSynthesisParams';
import { syncServiceRegistryFromProjectSettings } from '../services/registry';
import { getAllProjectSettings, type ProjectSettings } from '../web/services/projectSettings';
import { gameTtsMatchFor } from './gameTtsSettings';
import type { TtsReferenceMode } from './voiceToolPaths';

/** Map persisted project settings to TTS reference clip mode. */
export const voiceReferenceModeFromProjectSettings = (
  settings: ProjectSettings,
): TtsReferenceMode => (settings['voice.line_reference'] ? 'line' : 'speaker');

/** Map persisted project settings to synthesis params: per-game match flags plus the retry policy. */
export const voiceSynthesisFromProjectSettings = (
  settings: ProjectSettings,
  game?: string | null,
): TtsSynthesisParams => {
  const match = gameTtsMatchFor(settings['voice.game_tts'], game);
  return {
    matchLoudness: true,
    matchTiming: match.matchTiming,
    retryBelow: settings['voice.synth_retry_below'],
    retries: settings['voice.synth_retries'],
  };
};

/**
 * Push the service endpoints from project settings into the registry (and so into the
 * TTS, audio-intel and tools pools). The name is historical: it used to set only the
 * Fish Speech limit, which is still what `voice.tts_max_parallel_fish_speech` does for
 * the env-configured TTS host.
 */
export const syncTtsPoolFromProjectSettings = (settings: ProjectSettings): void => {
  syncServiceRegistryFromProjectSettings(settings);
};

/** Fish Speech concurrency limit from project settings. */
export const voiceTtsMaxParallelFromProjectSettings = (settings: ProjectSettings): number =>
  settings['voice.tts_max_parallel_fish_speech'];

/** Load voice synthesis settings from project_settings (match flags for `game`). */
export const loadVoiceProjectSettings = async (
  db: Tx,
  game?: string | null,
): Promise<{
  referenceMode: TtsReferenceMode;
  synthesis: TtsSynthesisParams;
  ttsMaxParallel: number;
}> => {
  const settings = await getAllProjectSettings(db);
  syncTtsPoolFromProjectSettings(settings);
  return {
    referenceMode: voiceReferenceModeFromProjectSettings(settings),
    synthesis: voiceSynthesisFromProjectSettings(settings, game),
    ttsMaxParallel: settings['voice.tts_max_parallel_fish_speech'],
  };
};
