/**
 * Pre-rendered media a game ships outside its text and voice assets: the
 * cutscenes under `Data/Video`. A game without one leaves `media` unset and the
 * video inventory, separation and dubbing skip it.
 */
export type GameMediaAdapter = {
  /** Folder of the cutscene videos, relative to the game install root. */
  readonly videoDir: string;
  /** Lower-case extensions (with the dot) of the videos in that folder. */
  readonly videoExtensions: readonly string[];
  /** Where a dubbed video goes inside a mod the mod manager deploys (`Video` for a Data-rooted mod). */
  readonly packDir: string;
  /**
   * The audio track id that carries the narration to translate (the game keeps
   * one track per language); the lowest id when unset or when a video lacks it.
   */
  readonly narrationTrackId?: number;
};
