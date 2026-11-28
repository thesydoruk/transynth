/**
 * Topic category and actor notes of INFO responses. Layouts read off
 * `Fallout4.esm` (20-byte `TRDA` with a response number) and `Starfield.esm`
 * (12-byte `TRDA`, base-form components); DIAL `DATA`, `SNAM` and the `NAM2`
 * after each `NAM1` are the same in both.
 */
import { describe, expect, it } from '@jest/globals';
import { STARFIELD_RECORD_LAYOUT } from '../../../games/creation-engine/import/recordLayouts';
import { extractVoiceDirection } from '../EspVoiceDirectionExtractor';
import { component, grup, plugin, record, struct, sub, u32, zstring } from './pluginBytes';

/** DIAL `DATA`: topic flags, category, subtype word. */
const topicData = (category: number): Buffer =>
  struct('DATA', 4, (d) => {
    d.writeUInt8(0, 0);
    d.writeUInt8(category, 1);
    d.writeUInt16LE(0, 2);
  });

const topic = (formId: number, category: number, subtype: string): Buffer =>
  record('DIAL', formId, [topicData(category), sub('SNAM', Buffer.from(subtype, 'ascii'))]);

/** Fallout 4 `TRDA`: emotion FormID, response number, then twelve more bytes. */
const numbered = (responseNumber: number): Buffer =>
  struct('TRDA', 20, (d) => d.writeUInt32LE(responseNumber, 4));

/** Starfield `TRDA`: emotion FormID, WEM id, float. */
const wemTrda = (wemId: number): Buffer => struct('TRDA', 12, (d) => d.writeUInt32LE(wemId, 4));

const info = (formId: number, fields: Buffer[]): Buffer => record('INFO', formId, fields);

describe('extractVoiceDirection', () => {
  const fallout = plugin([
    grup('DIAL', 0, [
      topic(0x0000d001, 3, 'FLEE'),
      grup(0x0000d001, 7, [
        info(0x0000a001, [
          numbered(1),
          u32('NAM1', 11),
          zstring('NAM2', 'quick shout as you flee'),
          numbered(102),
          u32('NAM1', 12),
          zstring('NAM2', ''),
          numbered(103),
          u32('NAM1', 13),
          zstring('NAM2', '  Yelling to his allies.  '),
        ]),
      ]),
      topic(0x0000d002, 7, 'HELO'),
      grup(0x0000d002, 7, [info(0x0000a002, [numbered(1), u32('NAM1', 14), zstring('NAM2', '')])]),
    ]),
    // A group that follows no topic.
    grup(0x0000dead, 7, [info(0x0000a003, [numbered(1), u32('NAM1', 15)])]),
  ]);

  it('gives each INFO the category and subtype of the topic above its group', () => {
    const direction = extractVoiceDirection(fallout);
    expect(direction.get('0000A001')?.topic).toEqual({ category: 3, subtype: 'FLEE' });
    expect(direction.get('0000A002')?.topic).toEqual({ category: 7, subtype: 'HELO' });
    expect(direction.get('0000A003')?.topic).toBeNull();
  });

  it('files an actor note under the number its response declares', () => {
    const notes = extractVoiceDirection(fallout).get('0000A001')!.notes;
    expect([...notes]).toEqual([
      [1, 'quick shout as you flee'],
      [103, 'Yelling to his allies.'],
    ]);
    expect(extractVoiceDirection(fallout).get('0000A002')!.notes.size).toBe(0);
  });

  it('numbers responses by position where the response data declares no number', () => {
    const starfield = plugin([
      grup('DIAL', 0, [
        record('DIAL', 0x0000d001, [
          // A component's fields are not the topic's own.
          ...component('BGSTest_Component', [topicData(3)]),
          topicData(5),
          sub('SNAM', Buffer.from('NOTC', 'ascii')),
        ]),
        grup(0x0000d001, 7, [
          info(0x0000a001, [
            ...component('BGSTest_Component', [zstring('NAM2', 'not a note')]),
            wemTrda(0x00ae4a02),
            u32('NAM1', 11),
            zstring('NAM2', ''),
            wemTrda(0x00ae4a03),
            u32('NAM1', 12),
            zstring('NAM2', 'shouting over gunfire'),
          ]),
        ]),
      ]),
    ]);

    const direction = extractVoiceDirection(starfield, STARFIELD_RECORD_LAYOUT);
    expect(direction.get('0000A001')?.topic).toEqual({ category: 5, subtype: 'NOTC' });
    expect([...direction.get('0000A001')!.notes]).toEqual([[2, 'shouting over gunfire']]);
  });
});
