import type { Tx } from '../db';
import type { TtsSynthesisParams } from '../tts/ttsSynthesisParams';
import { syncTtsPoolLimit } from '../tts/ttsRequestPool';
import { getAllProjectSettings, type ProjectSettings } from '../web/services/projectSettings';
import { gameTtsMatchFor } from './gameTtsSettings';
import type { TtsReferenceMode } from './voiceToolPaths';

/** Map persisted project settings to TTS reference clip mode. */
export const voiceReferenceModeFromProjectSettings = (
  settings: ProjectSettings,
): TtsReferenceMode => (settings['voice.line_reference'] ? 'line' : 'speaker');

/** Map persisted project settings to Fish Speech sampling + per-game xtts-engine match flags. */
export const voiceSynthesisFromProjectSettings = (
  settings: ProjectSettings,
  game?: string | null,
): TtsSynthesisParams => {
  const match = gameTtsMatchFor(settings['voice.game_tts'], game);
  return {
    temperature: settings['voice.temperature'],
    repetitionPenalty: settings['voice.repetition_penalty'],
    topP: settings['voice.top_p'],
    matchLoudness: match.matchLoudness,
    matchTiming: match.matchTiming,
  };
};

/** Push Fish Speech concurrency limit from project settings into the global pool. */
export const syncTtsPoolFromProjectSettings = (settings: ProjectSettings): void => {
  syncTtsPoolLimit(settings['voice.tts_max_parallel_fish_speech']);
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
