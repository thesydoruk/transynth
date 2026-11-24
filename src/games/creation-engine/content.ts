/**
 * Content kind of a Creation Engine plugin file: the title's first official
 * master is the game, the other masters are DLC, plugins named with one of the
 * title's add-on prefixes are store add-ons (Creation Club `cc*`, Starfield's
 * `sfbgs*` Creations), everything else is a mod.
 */
import type { GameContentAdapter, ModContentKind } from '../contract';
import type { CreationEngineTitle } from './title';

/** The Creation Club naming convention of Skyrim SE and Fallout 4. */
const DEFAULT_ADDON_PREFIXES: readonly string[] = ['cc'];

const PLUGIN_EXTENSIONS = ['.esm', '.esl', '.esp'];

const isPluginFileName = (lower: string): boolean =>
  PLUGIN_EXTENSIONS.some((ext) => lower.endsWith(ext));

export const createCreationEngineContentAdapter = (
  title: Pick<CreationEngineTitle, 'deployment' | 'addonPluginPrefixes'>,
): GameContentAdapter => {
  const masters = title.deployment.officialMasters.map((name) => name.toLowerCase());
  const addonPrefixes = (title.addonPluginPrefixes ?? DEFAULT_ADDON_PREFIXES).map((prefix) =>
    prefix.toLowerCase(),
  );
  return {
    classify(anchorFileName: string): ModContentKind {
      const lower = anchorFileName.toLowerCase();
      const at = masters.indexOf(lower);
      if (at === 0) return 'base';
      if (at > 0) return 'dlc';
      const isAddon =
        isPluginFileName(lower) && addonPrefixes.some((prefix) => lower.startsWith(prefix));
      return isAddon ? 'addon' : 'mod';
    },
  };
};
