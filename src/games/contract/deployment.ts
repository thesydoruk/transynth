/**
 * What a mod manager needs to know to deploy this game's mods.
 *
 * Only games managed through Vortex (and installed as a plugin load order)
 * provide this; everything else leaves `deployment` unset and is skipped by
 * the Vortex scan, the load-order writer, and the deployment manifest.
 */
export type GameDeploymentAdapter = {
  /** Base-game and DLC plugins that ship with the game, not with a mod. */
  readonly officialMasters: readonly string[];
  /** Folder under `%LOCALAPPDATA%` holding the game's plugin / load-order files. */
  readonly localAppFolder: string;
  /** Vortex's internal game id, used for `%APPDATA%/Vortex/<id>/profiles`. */
  readonly vortexId: string;
  /** Executable used to locate the install root during a scan. */
  readonly exeName: string;
};
