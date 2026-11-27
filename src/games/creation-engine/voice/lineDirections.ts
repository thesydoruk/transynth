/**
 * How the voiced lines of a Creation Engine plugin are delivered, by voice key.
 *
 * The plugin gives two hints per line — the category of its topic and the note
 * written for the actor (`extractVoiceDirection`). Here they are put under the
 * keys the rest of the voice code uses, `<origin>/FORMID6:variant`.
 *
 * Calm is decided by the topic's subtype, not its category. The category looks
 * like the natural switch (3 is combat, 5 detection) but is not reliable: the
 * raiders' hit, bleed-out, alert and lost-target topics of `Fallout4.esm` carry
 * category 0, the one of ordinary player topics. On five Fallout 4 voice types
 * (8,030 clips) a baseline built from categories 0, 2 and 7 found 74 % of the
 * shouted combat lines, one built from the subtypes below 84 %. Starfield
 * names its subtypes the same way; nothing was measured there.
 *
 * A calm topic is not yet a calm clip: a scene line can be shouted and an idle
 * can be a cough. Whoever builds a baseline also drops the lines that carry an
 * effort cue and the ones with nothing to say.
 */
import fs from 'node:fs';
import {
  DEFAULT_ESP_RECORD_LAYOUT,
  extractVoiceDirection,
  type EspRecordLayout,
} from '../../../formats/esp';
import { loadInfoVoiceSlots } from '../../../voice/infoResponseNumbers';
import { originFormidKey } from '../../../voice/voiceOrigin';
import { expandSharedResponseAliases, voiceTranslationMapKey } from '../../../voice/voiceTextRows';
import type { VoiceLineDirection } from '../../contract';

/** DIAL subtypes of ordinary talk: scenes, custom topics, hellos, greetings, idles, idle chatter. */
const CALM_TOPIC_SUBTYPES: ReadonlySet<string> = new Set([
  'SCEN',
  'CUST',
  'HELO',
  'GREE',
  'IDLE',
  'IDAT',
]);

/**
 * @param layout - The title's record layout; omitted, the plugin reads as Fallout 4.
 * @returns An empty map when the plugin cannot be read.
 *
 * @example
 * loadCreationEngineLineDirections('Data/Fallout4.esm').get('fallout4.esm/021B2A:1');
 * // { calmTopic: false, actorNote: 'quick shout as you flee' }
 */
export const loadCreationEngineLineDirections = (
  pluginPath: string,
  layout: EspRecordLayout = DEFAULT_ESP_RECORD_LAYOUT,
): Map<string, VoiceLineDirection> => {
  const directions = new Map<string, VoiceLineDirection>();
  let buf: Buffer;
  try {
    buf = fs.readFileSync(pluginPath);
  } catch {
    return directions;
  }

  const slots = loadInfoVoiceSlots(pluginPath, layout.plugin);
  // INFOs with no response of their own replay another's (`DNAM`); the topic is still theirs.
  const borrowerCalm = new Map<string, boolean>();

  for (const [formId, info] of extractVoiceDirection(buf, layout)) {
    const origin = slots.origins.originOfFormid(formId);
    const lineKey = slots.origins.lineKeyOfFormid(formId);
    const calmTopic = info.topic != null && CALM_TOPIC_SUBTYPES.has(info.topic.subtype);
    const numbers = slots.responses.get(formId);
    if (!numbers) {
      borrowerCalm.set(originFormidKey(origin, lineKey), calmTopic);
      continue;
    }
    for (const number of numbers) {
      directions.set(voiceTranslationMapKey(lineKey, number, origin), {
        calmTopic,
        actorNote: info.notes.get(number) ?? null,
      });
    }
  }

  expandSharedResponseAliases(directions, slots.sharedFrom);
  for (const [key, direction] of directions) {
    const calmTopic = borrowerCalm.get(key.slice(0, key.lastIndexOf(':')));
    if (calmTopic != null && calmTopic !== direction.calmTopic) {
      directions.set(key, { ...direction, calmTopic });
    }
  }
  return directions;
};
