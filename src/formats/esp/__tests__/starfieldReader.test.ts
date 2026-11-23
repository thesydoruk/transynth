/**
 * EspReader on a synthetic Starfield plugin: INFO speakers, INFO order from the
 * DIAL `TIFL` list (Starfield INFOs carry no previous-INFO `PNAM`), and INNR
 * name fragments next to a base-form component.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from '@jest/globals';
import { STARFIELD_RECORD_LAYOUT } from '../../../games/creation-engine/import/recordLayouts';
import type { TranslatableSubrecords } from '../../subrecords';
import { EspReader } from '../EspReader';
import {
  component,
  grup,
  plugin,
  record,
  struct,
  sub,
  u32,
  u32Array,
  zstring,
} from './pluginBytes';

const TEXT: Record<string, readonly string[]> = {
  DIAL: ['FULL'],
  INFO: ['NAM1', 'RNAM'],
  INNR: ['WNAM'],
};
const subrecords: TranslatableSubrecords = {
  isIgnoredRecord: () => false,
  isTranslatable: (rec, field) => TEXT[rec]?.includes(field) ?? false,
};

/** Starfield TRDA: emotion FormID, WEM id, emotion-out float — 12 bytes. */
const trda = (wemId: number): Buffer =>
  struct('TRDA', 12, (data) => {
    data.writeUInt32LE(0x0001a3c4, 0);
    data.writeUInt32LE(wemId, 4);
  });

/** One response: TRDA, NAM1 text, NAM2–NAM4, head tracking with an empty PNAM. */
const response = (wemId: number, text: string): Buffer[] => [
  trda(wemId),
  zstring('NAM1', text),
  zstring('NAM2', ''),
  zstring('NAM3', ''),
  zstring('NAM4', ''),
  sub('HNAM'),
  sub('PNAM'),
  sub('HNAM'),
];

const info = (formId: number, text: string, extra: Buffer[] = []): Buffer =>
  record('INFO', formId, [
    struct('ENAM', 4, () => undefined),
    ...extra,
    ...response(0x00ae4a02 + formId, text),
  ]);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-reader-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const writePlugin = (name: string, bytes: Buffer): string => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, bytes);
  return file;
};

const dialoguePlugin = (): string =>
  writePlugin(
    'Dialogue.esm',
    plugin(
      [
        grup('DIAL', 0, [
          record('DIAL', 0x01000800, [
            zstring('EDID', 'Greeting'),
            u32('QNAM', 0x01000900),
            u32Array('TIFL', [0x01000801, 0x01000802, 0x01000803]),
            u32('TIFC', 3),
          ]),
          grup(0x01000800, 7, [
            info(0x01000801, 'First.', [
              ...component('BGSAnimationGraph_Component', [zstring('ANAM', 'Rig')]),
            ]),
            info(0x01000802, 'Second.', [u32('ANAM', 0x0000a001)]),
            info(0x01000803, 'Third.', [zstring('RNAM', 'Ask.'), u32('ANAM', 0x0000a002)]),
          ]),
        ]),
      ],
      0x1,
      ['Starfield.esm'],
    ),
  );

describe('EspReader on Starfield INFO records', () => {
  it('orders INFOs by the DIAL TIFL list and reads the ANAM speaker', () => {
    const esp = new EspReader(dialoguePlugin(), subrecords, STARFIELD_RECORD_LAYOUT);
    const rows = esp.extractStrings().filter((row) => row.signature === 'INFO');

    expect(
      rows.map((row) => [
        row.formId,
        row.path,
        row.text,
        row.dialogTopicFormId,
        row.previousInfoFormId,
        row.speakerFormId,
      ]),
    ).toEqual([
      ['01000801', 'NAM1', 'First.', '01000800', undefined, undefined],
      ['01000802', 'NAM1', 'Second.', '01000800', '01000801', '0000A001'],
      ['01000803', 'RNAM', 'Ask.', '01000800', '01000802', '0000A002'],
      ['01000803', 'NAM1', 'Third.', '01000800', '01000802', '0000A002'],
    ]);
  });

  it('reads no order and a bogus speaker with the Fallout 4 layout', () => {
    const rows = new EspReader(dialoguePlugin(), subrecords)
      .extractStrings()
      .filter((row) => row.signature === 'INFO');
    expect(rows.map((row) => row.previousInfoFormId)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    // The component's 'Rig\0' string passes for a speaker FormID.
    expect(rows[0]!.speakerFormId).toBe('00676952');
  });
});

describe('EspReader on Starfield INNR records', () => {
  it('skips a WNAM nested in a base-form component', () => {
    const file = writePlugin(
      'Names.esm',
      plugin([
        record('INNR', 0x00000a10, [
          zstring('EDID', 'WeaponNames'),
          ...component('BGSPlanetContentManagerContentProperties_Component', [u32('WNAM', 3)]),
          u32('UNAM', 0x30),
          u32('VNAM', 2),
          zstring('WNAM', 'Rusty'),
          zstring('WNAM', '*'),
          zstring('WNAM', 'Advanced'),
        ]),
      ]),
    );
    const rows = new EspReader(file, subrecords, STARFIELD_RECORD_LAYOUT).extractStrings();
    expect(rows.map((row) => [row.path, row.text])).toEqual([
      ['WNAM[0]', 'Rusty'],
      ['WNAM[1]', 'Advanced'],
    ]);
  });
});
