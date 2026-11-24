/**
 * Takes named by WEM id: `<8 hex>.wem` (Wwise audio) with the lip animation in
 * a sibling `<8 hex>.ffxanim`. Starfield.
 *
 * The id is the `TRDA` "WEM File" of the response, not the INFO FormID, so
 * every question about a file — which line is it, what is its key — goes
 * through the plugin's WEM index (`infoWemIds.ts`).
 *
 * The Wwise codec of the takes this format writes is the title's choice and
 * comes in as a {@link WemTakeCodec}; reading a source take asks the file what
 * it is (`wemTakeAudio.ts`).
 */
import path from 'node:path';
import { wemTakeCodec, type WemCodecId, type WemTakeCodec } from '../../formats/wem';
import { discoverWemTakes } from '../discoverWemTakes';
import type { VoiceFileEntry } from '../discoverVoiceFiles';
import type { VoicePluginFormIds } from '../infoResponseNumbers';
import { loadInfoWemIndex, lookupLineWemId, lookupWemTakeLine } from '../infoWemIds';
import { buildVoicedWemFromTtsWav, FFXANIM_EXTENSION } from '../synthesizeVoicedWem';
import { originFromVoiceRelPath } from '../voiceOrigin';
import { voiceTranslationMapKey } from '../voiceTextRows';
import type { VoiceTakeFormat } from './types';

export { FFXANIM_EXTENSION } from '../synthesizeVoicedWem';
export const WEM_EXTENSION = '.wem';

/** A take or its animation: both carry the id, and both are exported by it. */
const WEM_TAKE_FILE_RE = /^([0-9A-Fa-f]{8})\.(wem|ffxanim)$/i;

const normalizeRelPath = (relPath: string): string => relPath.replace(/\\/g, '/');

const localizedWemRelPath = (entry: VoiceFileEntry): string => {
  const stem = entry.fileName.replace(/\.[^.]+$/, '');
  return normalizeRelPath(path.join(path.dirname(entry.relPath), `${stem}${WEM_EXTENSION}`));
};

const notATake = (): null => null;

/**
 * `<origin>/FORMID6:variant` for `…/Sound/Voice/<origin>/<Speaker>/<id>.wem`,
 * resolved against one plugin's INFO records. The index is read on the first
 * call, so making a resolver that is never used costs nothing.
 */
const wemVoiceKeyResolver = (
  pluginPath: string | null | undefined,
  pluginFormIds: VoicePluginFormIds | undefined,
): ((relPath: string) => string | null) => {
  if (!pluginPath) return notATake;
  let index: ReturnType<typeof loadInfoWemIndex> | undefined;
  return (relPath) => {
    const normalized = normalizeRelPath(relPath);
    const match = normalized.slice(normalized.lastIndexOf('/') + 1).match(WEM_TAKE_FILE_RE);
    if (!match) return null;
    index ??= loadInfoWemIndex(pluginPath, pluginFormIds);
    const line = lookupWemTakeLine(index, originFromVoiceRelPath(normalized), match[1]!);
    return line ? voiceTranslationMapKey(line.lineKey, line.variant, line.origin) : null;
  };
};

const createWemFfxanimTakes = (
  codec: WemTakeCodec,
  pluginFormIds: VoicePluginFormIds | undefined,
): VoiceTakeFormat => ({
  kind: 'wem-ffxanim',
  extension: WEM_EXTENSION,
  artifact: 'wem',
  sidecarExtensions: [FFXANIM_EXTENSION],
  needsSpeakerSex: true,
  pluginFormIds,

  discover: (packageDir, pluginRelPath) =>
    discoverWemTakes(packageDir, pluginRelPath, pluginFormIds),

  localizedRelPath: localizedWemRelPath,

  voiceKeyResolver: (pluginPath) => wemVoiceKeyResolver(pluginPath, pluginFormIds),

  ownTakeFileName: (pluginPath, entry) => {
    const id = lookupLineWemId(
      loadInfoWemIndex(pluginPath, pluginFormIds),
      entry.originPlugin,
      entry.lineKey,
      entry.variant,
    );
    return id ? `${id}${WEM_EXTENSION}` : null;
  },

  build: (input) => buildVoicedWemFromTtsWav(input, codec),
});

const formats = new Map<string, VoiceTakeFormat>();

/**
 * The `.wem` + `.ffxanim` take format writing one Wwise codec, for a title
 * whose plugins number their masters by `pluginFormIds` (omitted: the top byte
 * of a FormID is the master index). One object per combination.
 */
export const wemFfxanimTakes = (
  codecId: WemCodecId,
  pluginFormIds?: VoicePluginFormIds,
): VoiceTakeFormat => {
  const key = `${codecId}|${pluginFormIds ? JSON.stringify(pluginFormIds) : ''}`;
  let format = formats.get(key);
  if (!format) {
    format = createWemFfxanimTakes(wemTakeCodec(codecId), pluginFormIds);
    formats.set(key, format);
  }
  return format;
};
