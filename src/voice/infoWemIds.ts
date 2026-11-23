/**
 * Which line a Starfield voice file belongs to.
 *
 * Fallout 4 names a take after its line — `<INFO FormID>_<response>.fuz`.
 * Starfield names it after a number of its own: `<8 hex>.wem`, the "WEM File"
 * id in the response's `TRDA`. Nothing in that name says which INFO it is, so
 * the link has to be read out of the plugin: every response of every INFO with
 * the id it carries. This is that table, both ways round.
 *
 * A take keeps the identity the rest of the pipeline uses — origin plugin,
 * lower-6 of the INFO FormID, and a variant. The variant is the 1-based
 * position of the response in its INFO, the same number the text loaders give
 * a Starfield line (`infoResponseNumbers.ts`), so files and rows meet without
 * either knowing the WEM id.
 *
 * Built from the walk `infoResponseNumbers.ts` already does and cached with it.
 */
import {
  loadInfoVoiceSlots,
  type InfoResponseWemId,
  type InfoVoiceSlots,
  type VoicePluginFormIds,
} from './infoResponseNumbers';
import { normalizeVoiceOrigin } from './voiceOrigin';
import { voiceTranslationMapKey } from './voiceTextRows';

/** The line one WEM file is a take of. */
export type WemTakeLine = {
  /** Plugin that owns the INFO, lower-cased. */
  origin: string;
  /** Lower-6 of the INFO FormID, upper-case. */
  lineKey: string;
  /** 1-based position of the response in its INFO. */
  variant: number;
  /** The INFO's FormID as the plugin stores it. */
  infoFormidHex: string;
};

export type InfoWemIndex = {
  /** `<origin>/<wem id>` ({@link wemTakeKey}) → the response that names the file. */
  lineOfWem: Map<string, WemTakeLine>;
  /** `<origin>/<FORMID6>:<variant>` → the WEM id its take is named by. */
  wemOfLine: Map<string, string>;
};

/** A WEM id the way the game writes it in a file name: 8 lower-case hex digits. */
export const wemIdHex = (id: number): string => (id >>> 0).toString(16).padStart(8, '0');

/** Key of one voice file: the folder it sits in under `Sound/Voice/` and its id. */
export const wemTakeKey = (origin: string | null | undefined, wemId: string): string =>
  `${normalizeVoiceOrigin(origin)}/${wemId.toLowerCase()}`;

const addInfo = (
  index: InfoWemIndex,
  borrowedKeys: Set<string>,
  slots: InfoVoiceSlots,
  infoFormidHex: string,
  wemIds: InfoResponseWemId[],
): void => {
  const origin = slots.origins.originOfFormid(infoFormidHex);
  const lineKey = slots.origins.lineKeyOfFormid(infoFormidHex);
  const variants = slots.responses.get(infoFormidHex) ?? [];
  wemIds.forEach((wem, i) => {
    const variant = variants[i];
    if (wem.id === 0 || variant == null) return;
    const id = wemIdHex(wem.id);
    index.wemOfLine.set(voiceTranslationMapKey(lineKey, variant, origin), id);

    // Two responses can name one file: a response that replays another INFO's
    // take (`TROI`) carries that take's id. The file then belongs to the line
    // it was recorded for; a borrower only answers when nothing else does.
    const key = wemTakeKey(origin, id);
    const taken = index.lineOfWem.has(key);
    if (taken && (wem.borrowed || !borrowedKeys.has(key))) return;
    index.lineOfWem.set(key, { origin, lineKey, variant, infoFormidHex });
    if (wem.borrowed) borrowedKeys.add(key);
    else borrowedKeys.delete(key);
  });
};

/** Index the WEM ids of one plugin's INFO responses. */
export const buildInfoWemIndex = (slots: InfoVoiceSlots): InfoWemIndex => {
  const index: InfoWemIndex = { lineOfWem: new Map(), wemOfLine: new Map() };
  const borrowedKeys = new Set<string>();
  for (const [infoFormidHex, wemIds] of slots.wemIds) {
    addInfo(index, borrowedKeys, slots, infoFormidHex, wemIds);
  }
  return index;
};

/** One index per parsed plugin; dropped with the slots when the plugin cache evicts them. */
const indexes = new WeakMap<InfoVoiceSlots, InfoWemIndex>();

/**
 * The WEM index of a plugin on disk (empty when the file is missing, unreadable,
 * or a title whose `TRDA` names no file).
 *
 * @param plugin - The title's FormID rule (`EspRecordLayout.plugin`), which
 *   decides the origin and line key of each INFO; omitted, read as Fallout 4.
 */
export const loadInfoWemIndex = (
  pluginAbsPath: string,
  plugin?: VoicePluginFormIds,
): InfoWemIndex => {
  const slots = loadInfoVoiceSlots(pluginAbsPath, plugin);
  let index = indexes.get(slots);
  if (!index) {
    index = buildInfoWemIndex(slots);
    indexes.set(slots, index);
  }
  return index;
};

/** The line a voice file is a take of, by the folder it is in and its name's id. */
export const lookupWemTakeLine = (
  index: InfoWemIndex,
  origin: string | null | undefined,
  wemId: string,
): WemTakeLine | undefined => index.lineOfWem.get(wemTakeKey(origin, wemId));

/** The WEM id a plugin gives one response, or undefined when it names none. */
export const lookupLineWemId = (
  index: InfoWemIndex,
  origin: string | null | undefined,
  lineKey: string,
  variant: number,
): string | undefined => index.wemOfLine.get(voiceTranslationMapKey(lineKey, variant, origin));
