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
import { voiceTtsPayloadVersionFromPrepared } from '../../../voice/voiceTtsPayloadVersion';
import { loadVoiceResynthContext, voiceTakeNeedsWork } from '../../../voice/voiceResynth';
import type { VoiceLocalizeRequest, VoiceLocalizeSink } from '../../contract';

export const countCreationEngineVoiceWork = async (
  db: Tx,
  request: VoiceLocalizeRequest,
): Promise<number> => {
  const { modId, extractDir, pluginPath, srcLang, tgtLang, scope, onlyKeys } = request;
  const packages = resolveImportPackages(extractDir, tgtLang, pluginPath);
  const storedVersions = await loadVoiceSynthesisVersionMap(db, modId, tgtLang);
  const resynth = request.resynth
    ? await loadVoiceResynthContext(db, modId, tgtLang, request.resynth)
    : undefined;
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

      const speakerKey = voiceSpeakerKey(entry, voiceRootRel);
      const fuzDest = toDiskPath(pkg.localizeDir, outputLocalizedFuzRelPath(entry));
      const due = voiceTakeNeedsWork({
        force: forceAll,
        resynth,
        speakerKey,
        lineKey: entry.lineKey,
        variant: entry.variant,
        storedVersion: lookupVoiceSynthesisVersion(
          storedVersions,
          speakerKey,
          entry.lineKey,
          entry.variant,
        ),
        payloadVersion: voiceTtsPayloadVersionFromPrepared(prepared, tgtLang),
        fileExists: fs.existsSync(fuzDest),
      });
      if (!due) continue;
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
        resynth: request.resynth,
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
