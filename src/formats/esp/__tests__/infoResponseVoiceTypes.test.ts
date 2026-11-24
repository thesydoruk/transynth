/**
 * Starfield INFO responses list the voice types that say them: `TROT`, after
 * the response's `TRDA`, an array of (VTYP FormID, float) — xEdit's
 * `wbDefinitionsSF1.pas`, INFO → Responses.
 */
import { describe, expect, it } from '@jest/globals';
import { STARFIELD_RECORD_LAYOUT } from '../../../games/creation-engine/import/recordLayouts';
import { extractInfoResponseVoiceTypes } from '../EspInfoVoiceExtractor';
import { DEFAULT_ESP_RECORD_LAYOUT } from '../recordLayout';
import { component, grup, plugin, record, struct, u32 } from './pluginBytes';

const trda = (wemId: number): Buffer =>
  struct('TRDA', 12, (d) => {
    d.writeUInt32LE(0, 0);
    d.writeUInt32LE(wemId, 4);
    d.writeFloatLE(0, 8);
  });

const trot = (entries: Array<[number, number]>): Buffer =>
  struct('TROT', entries.length * 8, (d) =>
    entries.forEach(([voiceType, value], i) => {
      d.writeUInt32LE(voiceType, i * 8);
      d.writeFloatLE(value, i * 8 + 4);
    }),
  );

const info = (formId: number, fields: Buffer[]): Buffer => record('INFO', formId, fields);

const starfieldPlugin = (): Buffer =>
  plugin([
    grup('DIAL', 0, [
      grup(0x0000e001, 7, [
        info(0x0000a001, [
          // A component's fields are not the record's own.
          ...component('BGSTest_Component', [trot([[0x00009999, 1]])]),
          trda(0x00ae4a02),
          trot([
            [0x00005984, 2.13],
            [0x00005985, 7.4],
          ]),
          u32('NAM1', 11),
          trda(0x00ae4a03),
          u32('NAM1', 12),
          trda(0x00ae4a04),
          trot([
            [0x00005984, 1],
            [0x00005984, 3],
            [0, 0],
          ]),
          u32('NAM1', 13),
        ]),
        // Lists nothing: left out.
        info(0x0000a002, [trda(0x00ae4a05), u32('NAM1', 14)]),
      ]),
    ]),
  ]);

describe('extractInfoResponseVoiceTypes', () => {
  it('lists the voice types of each response in order, one array per TRDA', () => {
    const listed = extractInfoResponseVoiceTypes(starfieldPlugin(), STARFIELD_RECORD_LAYOUT);
    expect([...listed]).toEqual([['0000A001', [['00005984', '00005985'], [], ['00005984']]]]);
  });

  it('reads nothing for a title whose INFOs carry no such list', () => {
    expect(extractInfoResponseVoiceTypes(starfieldPlugin(), DEFAULT_ESP_RECORD_LAYOUT).size).toBe(
      0,
    );
  });
});
