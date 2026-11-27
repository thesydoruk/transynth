/**
 * What a plugin says about how its voiced lines are delivered.
 *
 * Two facts, the same in Fallout 4 and Starfield (read off both masters):
 *
 *   - the topic a line belongs to. A DIAL's 4-byte `DATA` holds a category in
 *     byte 1 (0 topic, 2 scene, 3 combat, 4 favors, 5 detection, 7
 *     miscellaneous) and `SNAM` a four-letter subtype (`ATCK`, `HELO`, …). The
 *     subtype is the one to trust: `Fallout4.esm` files hit and alert topics
 *     of some quests under category 0. The INFOs of a topic sit in the group
 *     that follows it — group type 7, labelled with the DIAL's FormID;
 *   - the note written for the voice actor: `NAM2`, right after the `NAM1` of
 *     the response it directs ("quick shout as you flee"). 40 % of the
 *     responses in `Fallout4.esm` carry one, 20 % in `Starfield.esm`.
 */
import { decodeGameText } from '../strings';
import { readInfoResponseNumber } from './infoResponseNumber';
import {
  GRUP_HEADER_SIZE,
  RECORD_HEADER_SIZE,
  forEachSubrecord,
  formatFormId,
  readRecordData,
} from './recordData';
import { DEFAULT_ESP_RECORD_LAYOUT, type EspRecordLayout } from './recordLayout';

/** Group type of the INFOs that belong to one DIAL. */
const TOPIC_CHILDREN_GROUP = 7;

export type DialogTopicKind = {
  /** Category byte of the DIAL `DATA`. */
  category: number;
  /** Four-letter subtype from `SNAM`; empty when the topic names none. */
  subtype: string;
};

export type InfoVoiceDirection = {
  /** The topic the INFO sits under; null when its group follows no DIAL. */
  topic: DialogTopicKind | null;
  /** Response number → actor note, for the responses that have one. */
  notes: ReadonlyMap<number, string>;
};

/** INFO FormID (8 hex, as stored) → what the plugin says about its delivery. */
export type VoiceDirection = Map<string, InfoVoiceDirection>;

const NO_NOTES: ReadonlyMap<number, string> = new Map();

const parseTopic = (data: Buffer, layout: EspRecordLayout): DialogTopicKind | null => {
  let category: number | null = null;
  let subtype = '';
  forEachSubrecord(
    data,
    (sig, start, end) => {
      if (sig === 'DATA' && end - start >= 2) category = data.readUInt8(start + 1);
      else if (sig === 'SNAM' && end - start === 4) subtype = data.toString('ascii', start, end);
    },
    layout.baseFormComponents,
  );
  return category == null ? null : { category, subtype };
};

const parseNotes = (data: Buffer, layout: EspRecordLayout): ReadonlyMap<number, string> => {
  let notes: Map<number, string> | null = null;
  let position = 0;
  let declared: number | null = null;
  let current: number | null = null;
  forEachSubrecord(
    data,
    (sig, start, end) => {
      if (sig === 'TRDA') {
        declared = readInfoResponseNumber(data, start, end);
      } else if (sig === 'NAM1') {
        position += 1;
        current = declared ?? position;
        declared = null;
      } else if (sig === 'NAM2' && current != null) {
        const note = decodeGameText(data, start, end).replace(/\0/g, '').trim();
        if (note) (notes ??= new Map()).set(current, note);
      }
    },
    layout.baseFormComponents,
  );
  return notes ?? NO_NOTES;
};

/**
 * Collect the topic and the actor notes of every INFO of a plugin.
 *
 * @example
 * extractVoiceDirection(buf).get('00021B2A');
 * // { topic: { category: 3, subtype: 'FLEE' }, notes: Map { 1 => 'quick shout as you flee' } }
 */
export const extractVoiceDirection = (
  buf: Buffer,
  layout: EspRecordLayout = DEFAULT_ESP_RECORD_LAYOUT,
): VoiceDirection => {
  const result: VoiceDirection = new Map();
  const topics = new Map<number, DialogTopicKind>();

  const walk = (start: number, end: number, topic: DialogTopicKind | null): void => {
    let p = start;
    while (p + RECORD_HEADER_SIZE <= end) {
      const sig = buf.toString('ascii', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (sig === 'GRUP') {
        if (size < GRUP_HEADER_SIZE) break;
        const ownTopic =
          buf.readInt32LE(p + 12) === TOPIC_CHILDREN_GROUP
            ? (topics.get(buf.readUInt32LE(p + 8)) ?? null)
            : topic;
        walk(p + GRUP_HEADER_SIZE, Math.min(p + size, end), ownTopic);
        p += size;
        continue;
      }
      if (sig === 'DIAL' || sig === 'INFO') {
        const formId = buf.readUInt32LE(p + 12);
        const data = readRecordData(buf, p);
        if (data && sig === 'DIAL') {
          const kind = parseTopic(data, layout);
          if (kind) topics.set(formId, kind);
        } else if (data) {
          result.set(formatFormId(formId), { topic, notes: parseNotes(data, layout) });
        }
      }
      p += RECORD_HEADER_SIZE + size;
    }
  };

  walk(RECORD_HEADER_SIZE + buf.readUInt32LE(4), buf.length, null);
  return result;
};
