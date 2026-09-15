/**
 * Which plugin files in an extracted upload are the real ones.
 *
 * Mod archives often ship extra copies of a plugin under `Optional/` or
 * `fomod/` for the installer to pick from. Those are not what the mod
 * actually loads, so import, packaging, and the Vortex scan all skip them.
 */

/** Path segments that mark optional / installer-only plugin copies. */
const SECONDARY_PLUGIN_DIR_NAMES = new Set([
  'optional',
  'fomod',
  'docs',
  'documentation',
  'readmes',
]);

/** True when a plugin lives under Optional/, fomod/, docs/, etc. */
export const isSecondaryPluginPath = (pluginPath: string): boolean => {
  const parts = pluginPath.replace(/\\/g, '/').split('/');
  return parts.some((part) => SECONDARY_PLUGIN_DIR_NAMES.has(part.toLowerCase()));
};

/** Plugins suitable as the primary import target. */
export const filterPrimaryPlugins = (plugins: string[]): string[] =>
  plugins.filter((plugin) => !isSecondaryPluginPath(plugin));
