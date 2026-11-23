/**
 * Which plugin a voiced line belongs to — its *origin*.
 *
 * A Creation Engine plugin can carry INFO records it does not own: a patch such
 * as the Unofficial Fallout 4 Patch overrides thousands of `Fallout4.esm` and
 * DLC lines. The game keeps the voice file where the record was born, under
 * `Sound/Voice/<origin plugin>/`, and so does the patch when it ships a fixed
 * take. Two facts follow:
 *
 *   - a voice line is identified by (origin, FormID lower-6, response number),
 *     never by the lower-6 alone — two masters of one plugin can collide there;
 *   - the origin of a record in the database is read off the FormID: its top
 *     byte indexes the plugin's `MAST` list, and an index past that list means
 *     the plugin's own record (this also covers ESL-flagged `FE` FormIDs).
 *
 * Origins are plugin file names in lower case, so a folder on disk and a name
 * from a TES4 header compare equal whatever case either was written in.
 *
 * A title whose plugins number small and medium masters on their own
 * (Starfield, `formIdMasterSlots: 'byKind'`) reads the owner through
 * `formIdMasterIndex`: `FE` + 12-bit slot is the n-th small master, `FD` +
 * 8-bit slot the n-th medium one, any other top byte the n-th full one. The
 * line key there is the record's object id as its owner numbers it — 12 bits
 * for a small owner, 16 for a medium one — so an override and the master's own
 * record meet whatever slot the master has in the overriding plugin. The kind
 * of each master comes from its own header; a master not on disk counts as
 * full, so a small or medium FormID pointing at it reads as the plugin's own.
 *
 * Known gap (`plain` titles): an override of a record owned by an ESL-flagged
 * master is stored as `MM000yyy`, while that master names its own take
 * `FExxxyyy`; those two do not meet here. No mod in the corpus overrides ESL
 * dialogue yet.
 */
import path from 'node:path';
import { formIdMasterIndex } from '../formats/esp/pluginHeader';
import type { EspRecordLayout, PluginKind } from '../formats/esp/recordLayout';

export type VoiceOriginResolver = {
  /** The plugin's own file name, lower-cased. */
  ownOrigin: string;
  /** `MAST` names in header order (original case). */
  masters: string[];
  /** Origin of a record by its 8-hex FormID as stored in this plugin. */
  originOfFormid: (formidHex: string) => string;
  /**
   * Line key of a record by its 8-hex FormID as stored in this plugin: the
   * lower six hex digits, upper-case — for a `byKind` title, the object id
   * within its owner, padded to six.
   */
  lineKeyOfFormid: (formidHex: string) => string;
};

/** How a title's FormIDs name their master, and the kinds of this plugin's masters. */
export type VoiceOriginFormIds = {
  slots: EspRecordLayout['plugin']['formIdMasterSlots'];
  /** Kind of each `MAST` entry from its own header; null when it is not on disk. */
  masterKinds: ReadonlyArray<PluginKind | null>;
};

export const normalizeVoiceOrigin = (name: string | null | undefined): string =>
  (name ?? '').trim().toLowerCase();

const padFormid = (formidHex: string): string => formidHex.trim().toUpperCase().padStart(8, '0');

const masterIndexOf = (formidHex: string): number => {
  const idx = Number.parseInt(padFormid(formidHex).slice(0, 2), 16);
  return Number.isFinite(idx) ? idx : 0;
};

/** Object id within the owner: `FE` keeps 12 bits, `FD` 16, anything else 24. */
const objectIdKey = (formidHex: string): string => {
  const padded = padFormid(formidHex);
  const top = padded.slice(0, 2);
  if (top === 'FE') return padded.slice(5).padStart(6, '0');
  if (top === 'FD') return padded.slice(4).padStart(6, '0');
  return padded.slice(2);
};

/**
 * @param formIds - The title's FormID rule and the masters' kinds; omitted, the
 *   top byte indexes `MAST` (Fallout 4 and older).
 */
export const buildVoiceOriginResolver = (
  pluginFileName: string,
  masters: string[],
  formIds?: VoiceOriginFormIds,
): VoiceOriginResolver => {
  const ownOrigin = normalizeVoiceOrigin(path.basename(pluginFileName));
  const normalizedMasters = masters.map(normalizeVoiceOrigin);

  if (formIds?.slots === 'byKind') {
    const kinds = masters.map((_, i) => formIds.masterKinds[i] ?? 'full');
    return {
      ownOrigin,
      masters,
      originOfFormid: (formidHex) => {
        const raw = Number.parseInt(padFormid(formidHex), 16);
        const idx = Number.isFinite(raw) ? formIdMasterIndex(raw >>> 0, kinds, 'byKind') : -1;
        return idx >= 0 ? normalizedMasters[idx]! : ownOrigin;
      },
      lineKeyOfFormid: objectIdKey,
    };
  }

  return {
    ownOrigin,
    masters,
    originOfFormid: (formidHex) => {
      const idx = masterIndexOf(formidHex);
      return idx < normalizedMasters.length ? normalizedMasters[idx]! : ownOrigin;
    },
    lineKeyOfFormid: (formidHex) => padFormid(formidHex).slice(2),
  };
};

/**
 * Origin folder of a take by its path: the segment right after `Sound/Voice/`,
 * lower-cased. Null when the path has no voice tree in it.
 */
export const originFromVoiceRelPath = (relPath: string): string | null => {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = 0; i + 2 < parts.length; i += 1) {
    if (parts[i]!.toLowerCase() === 'sound' && parts[i + 1]!.toLowerCase() === 'voice') {
      return normalizeVoiceOrigin(parts[i + 2]);
    }
  }
  return null;
};

/**
 * Speaker (voice-type) folder of a take by its path: the segment after the
 * origin folder, when there is a file below it. Null outside a voice tree.
 */
export const speakerFromVoiceRelPath = (relPath: string): string | null => {
  const parts = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  for (let i = 0; i + 4 < parts.length; i += 1) {
    if (parts[i]!.toLowerCase() === 'sound' && parts[i + 1]!.toLowerCase() === 'voice') {
      return parts[i + 3]!;
    }
  }
  return null;
};

/** `<origin>/<FORMID6>` — the group a response number is relative to. */
export const originFormidKey = (origin: string | null | undefined, lineKey: string): string => {
  const key = lineKey.toUpperCase();
  const normalized = normalizeVoiceOrigin(origin);
  return normalized ? `${normalized}/${key}` : key;
};

/** Split `<origin>/<FORMID6>` back into its halves (origin may be absent). */
export const splitOriginFormidKey = (key: string): { origin: string | null; lineKey: string } => {
  const slash = key.lastIndexOf('/');
  if (slash < 0) return { origin: null, lineKey: key };
  return { origin: key.slice(0, slash), lineKey: key.slice(slash + 1) };
};
