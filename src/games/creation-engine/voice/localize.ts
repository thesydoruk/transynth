/**
 * Mod-wide voice synthesis for a Creation Engine title.
 *
 * Walks every source take in the mod's packages, pairs it with the reviewed
 * translation of its INFO line, and writes a localized `.fuz` (plus lip-sync)
 * into the localize tree. A take whose payload has not changed since the last
 * run is skipped unless the job forces it.
 */
import fs from 'node:fs';
import type { Tx } from '../../../db';
import { pluginRelPath, resolveImportPackages, toDiskPath } from '../../../modImport';
import {
  dedupeVoiceFiles,
  discoverVoiceFiles,
  resolveVoiceRootRel,
} from '../../../voice/discoverVoiceFiles';
import {
  loadVoiceTranslations,
  lookupVoiceTranslation,
  voiceTranslationMapKey,
} from '../../../voice/loadVoiceTranslations';
import { localizeVoicePackage } from '../../../voice/localizeVoicePackage';
import { canSynthesizeVoiceLine, prepareVoiceTtsText } from '../../../voice/prepareVoiceTtsText';
import { voiceSpeakerKey } from '../../../voice/speakerReference';
import { outputLocalizedFuzRelPath } from '../../../voice/voiceFilePaths';
import {
  loadVoiceSynthesisVersionMap,
  lookupVoiceSynthesisVersion,
} from '../../../voice/voiceSynthesisState';
import {
  isVoiceSynthesisCurrent,
  voiceTtsPayloadVersionFromPrepared,
} from '../../../voice/voiceTtsPayloadVersion';
import type { VoiceLocalizeRequest, VoiceLocalizeSink } from '../../contract';

export const countCreationEngineVoiceWork = async (
  db: Tx,
  request: VoiceLocalizeRequest,
): Promise<number> => {
  const { modId, extractDir, pluginPath, srcLang, tgtLang, scope, onlyKeys } = request;
  const packages = resolveImportPackages(extractDir, tgtLang, pluginPath);
  const storedVersions = await loadVoiceSynthesisVersionMap(db, modId, tgtLang);
  const forceAll = scope === 'all';
  const speakerFilter = request.speakerKey?.trim() || '';
  let total = 0;

  for (const pkg of packages) {
    const pluginRel = pluginRelPath(pkg.packageDir, pkg.pluginPath);
    const voiceRootRel = resolveVoiceRootRel(pluginRel);
    const translations = await loadVoiceTranslations(db, modId, srcLang, tgtLang);
    const voiceFiles = dedupeVoiceFiles(discoverVoiceFiles(pkg.packageDir, pluginRel));

    for (const entry of voiceFiles) {
      if (onlyKeys && !onlyKeys.has(voiceTranslationMapKey(entry.lineKey, entry.variant))) {
        continue;
      }
      if (speakerFilter && voiceSpeakerKey(entry, voiceRootRel) !== speakerFilter) continue;

      const row = lookupVoiceTranslation(translations, entry.lineKey, entry.variant);
      if (!row || !canSynthesizeVoiceLine(row.source, row.translation, row.edid)) continue;

      const prepared = prepareVoiceTtsText({
        lineSource: row.source,
        translation: row.translation,
        speakerSource: row.source,
        edid: row.edid,
      });
      if (prepared.action !== 'synthesize') continue;

      if (!forceAll) {
        const payloadVersion = voiceTtsPayloadVersionFromPrepared(prepared, tgtLang);
        const fuzDest = toDiskPath(pkg.localizeDir, outputLocalizedFuzRelPath(entry));
        const storedVersion = lookupVoiceSynthesisVersion(
          storedVersions,
          voiceSpeakerKey(entry, voiceRootRel),
          entry.lineKey,
          entry.variant,
        );
        if (isVoiceSynthesisCurrent(storedVersion, payloadVersion, fs.existsSync(fuzDest))) {
          continue;
        }
      }
      total += 1;
    }
  }
  return total;
};

export const localizeCreationEngineVoice = async (
  db: Tx,
  request: VoiceLocalizeRequest,
  sink: VoiceLocalizeSink,
): Promise<void> => {
  const packages = resolveImportPackages(request.extractDir, request.tgtLang, request.pluginPath);

  for (const pkg of packages) {
    if (request.shouldCancel?.()) break;
    await localizeVoicePackage(
      db,
      request.modId,
      pkg,
      request.srcLang,
      request.tgtLang,
      {
        game: request.game,
        ttsBaseUrl: request.ttsBaseUrl,
        dryRun: request.dryRun,
        force: request.force,
        scope: request.scope,
        referenceMode: request.referenceMode,
        synthesis: request.synthesis,
        onlyKeys: request.onlyKeys,
        speakerKey: request.speakerKey,
        limit: request.limit,
        shouldCancel: request.shouldCancel,
        signal: request.signal,
        onEligibleStep: request.onEligibleStep,
      },
      sink.written,
      sink.skipped,
      sink.warnings,
    );
  }
};
