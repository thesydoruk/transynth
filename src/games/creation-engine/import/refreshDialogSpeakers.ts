/**
 * Re-derive dialog speakers for a Creation Engine mod already in the database.
 *
 * Import writes `dialog_speakers` and the addressee columns of `dialog_nodes`
 * from the plugin's INFO/DIAL tree, its ANAM speaker actors, the VTYP voice
 * types of its masters, and the scenes that name an alias. All of that is read
 * again here, straight off the files on disk, so a change to the derivation
 * reaches mods that were imported before it — far cheaper than a re-import and
 * without touching a single translated string.
 *
 * Manual `dialog_speakers.gender_override` values survive: the resolver only
 * ever writes `detected_gender`.
 */
import fs from 'node:fs';
import type { DialogSpeakerRefresh, DialogSpeakerRefreshContext } from '../../contract';
import { EspReader } from '../../../formats/esp';
import {
  buildPluginSpeakerIndex,
  buildSpeakerActorIndex,
  loadPluginPathByBasename,
  resolveModDialogSpeakers,
} from '../../../import/dialogSpeakers';
import { discoverArchiveCandidatesForPlugin } from '../../../import/mod/discovery';
import { discoverLocaleSources } from '../../../import/mod/localeSources';
import { resolveEnglishLocaleMaps } from '../../../import/mod/localeRows';
import { buildVoiceFolderMap } from '../../../import/mod/speakerMaps';
import { resolveModStoredPath } from '../../../modStorage/paths';
import type { CreationEngineTitle } from '../title';

export const refreshCreationEngineDialogSpeakers = async (
  title: CreationEngineTitle,
  { db, modId, modPath, srcLang, dryRun }: DialogSpeakerRefreshContext,
): Promise<DialogSpeakerRefresh> => {
  const pluginPath = resolveModStoredPath(modPath);
  if (!fs.existsSync(pluginPath)) {
    throw new Error(`Plugin missing at ${pluginPath}`);
  }

  const esp = new EspReader(pluginPath, title.subrecords);
  const localeSources = esp.info.isLocalized
    ? discoverLocaleSources(pluginPath, title, discoverArchiveCandidatesForPlugin(pluginPath))
    : [];

  const index = buildPluginSpeakerIndex({
    actorIndex: buildSpeakerActorIndex(esp, title, await loadPluginPathByBasename(db)),
    englishStrings: resolveEnglishLocaleMaps(localeSources)?.get('STRINGS') ?? null,
    npcReferenceNames: title.npcReference(),
    voiceFolders: buildVoiceFolderMap(pluginPath),
  });

  const actors = index.actors.size;
  if (dryRun) return { actors, speakers: 0, withGender: 0, recoveredSpeakers: 0 };

  await db.query('BEGIN');
  try {
    const result = await resolveModDialogSpeakers(db, modId, index, srcLang);
    await db.query('COMMIT');
    return { actors, ...result };
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
};
