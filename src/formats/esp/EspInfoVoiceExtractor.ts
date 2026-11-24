/**
 * The voice types an INFO's responses list for themselves.
 *
 * Starfield writes, inside each response after its `TRDA`, a `TROT` array of
 * (VTYP FormID, float) pairs naming the voice types that say the response. It
 * is the plugin's own statement of who speaks a line, where Fallout 4 leaves
 * that to the folders its `.fuz` takes sit in. Titles whose layout names no
 * such subrecord get an empty result without a walk.
 */
import { log } from '../../logger';
import {
  GRUP_HEADER_SIZE,
  RECORD_HEADER_SIZE,
  forEachSubrecord,
  formatFormId,
  readRecordData,
} from './recordData';
import type { EspRecordLayout } from './recordLayout';

/** Subrecord that opens one response of an INFO. */
const RESPONSE_DATA = 'TRDA';

/** One entry of the list: voice type FormID (uint32) + a float. */
const ENTRY_SIZE = 8;

/**
 * INFO FormID (8 hex, as stored) → per response in file order, the VTYP
 * FormIDs it lists. A response without a list has an empty array, so the
 * index + 1 is the response's number.
 */
export type InfoResponseVoiceTypes = Map<string, string[][]>;

const parseInfo = (
  buf: Buffer,
  recOffset: number,
  layout: EspRecordLayout,
  listSig: string,
): string[][] | null => {
  const data = readRecordData(buf, recOffset);
  if (!data) return null;

  const responses: string[][] = [];
  let listed = false;
  forEachSubrecord(
    data,
    (sig, start, end) => {
      if (sig === RESPONSE_DATA) {
        responses.push([]);
        return;
      }
      if (sig !== listSig || responses.length === 0) return;
      const current = responses[responses.length - 1]!;
      for (let p = start; p + ENTRY_SIZE <= end; p += ENTRY_SIZE) {
        const raw = data.readUInt32LE(p);
        if (raw === 0) continue;
        const formId = formatFormId(raw);
        if (!current.includes(formId)) current.push(formId);
        listed = true;
      }
    },
    layout.baseFormComponents,
  );
  return listed ? responses : null;
};

/**
 * Collect the per-response voice type lists of every INFO of a plugin.
 * INFOs that list none are left out.
 */
export const extractInfoResponseVoiceTypes = (
  buf: Buffer,
  layout: EspRecordLayout,
): InfoResponseVoiceTypes => {
  const result: InfoResponseVoiceTypes = new Map();
  const listSig = layout.infoResponseVoiceTypes;
  if (!listSig) return result;

  const walk = (start: number, end: number): void => {
    let p = start;
    while (p + RECORD_HEADER_SIZE <= end) {
      const sig = buf.toString('ascii', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (sig === 'GRUP') {
        if (size < GRUP_HEADER_SIZE) break;
        walk(p + GRUP_HEADER_SIZE, Math.min(p + size, end));
        p += size;
        continue;
      }
      if (sig === 'INFO') {
        const responses = parseInfo(buf, p, layout, listSig);
        if (responses) result.set(formatFormId(buf.readUInt32LE(p + 12)), responses);
      }
      p += RECORD_HEADER_SIZE + size;
    }
  };

  walk(RECORD_HEADER_SIZE + buf.readUInt32LE(4), buf.length);
  log.debug(`ESP: ${result.size} INFO record(s) list their voice types in ${listSig}`);
  return result;
};
