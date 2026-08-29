import { describe, it, expect } from '@jest/globals';
import { deflateSync, inflateSync } from 'zlib';
import { patchEsp } from '../espPatcher';
import { parseSubrecordPath } from '../subrecordPath';
import type { EspPatch } from '../../types';

const zstring = (sig: string, text: string): Buffer => {
  const payload = Buffer.from(`${text}\0`, 'utf8');
  const header = Buffer.alloc(6);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt16LE(payload.length, 4);
  return Buffer.concat([header, payload]);
};

const buildRecord = (
  sig: string,
  formId: number,
  subrecords: Buffer[],
  compress = false,
): Buffer => {
  const raw = Buffer.concat(subrecords);
  let data = raw;
  let flags = 0;
  if (compress) {
    flags = 0x00040000;
    const size = Buffer.alloc(4);
    size.writeUInt32LE(raw.length, 0);
    data = Buffer.concat([size, deflateSync(raw)]);
  }
  const header = Buffer.alloc(24);
  header.write(sig, 0, 4, 'ascii');
  header.writeUInt32LE(data.length, 4);
  header.writeUInt32LE(flags, 8);
  header.writeUInt32LE(formId, 12);
  return Buffer.concat([header, data]);
};

const buildPlugin = (records: Buffer[]): Buffer => {
  const tes4 = Buffer.alloc(24);
  tes4.write('TES4', 0, 4, 'ascii');
  tes4.writeUInt32LE(0, 4);
  return Buffer.concat([tes4, ...records]);
};

/** Read every occurrence of one subrecord signature from a patched plugin. */
const readTexts = (plugin: Buffer, sig: string): string[] => {
  const texts: string[] = [];
  let pos = 24 + plugin.readUInt32LE(4); // skip the TES4 header record

  while (pos + 24 <= plugin.length) {
    const dataSize = plugin.readUInt32LE(pos + 4);
    const flags = plugin.readUInt32LE(pos + 8);
    const data = plugin.subarray(pos + 24, pos + 24 + dataSize);
    const body = (flags & 0x00040000) !== 0 ? inflateSync(data.subarray(4)) : data;

    let sub = 0;
    while (sub + 6 <= body.length) {
      const subSig = body.toString('ascii', sub, sub + 4);
      const subSize = body.readUInt16LE(sub + 4);
      const start = sub + 6;
      if (subSig === sig) {
        texts.push(body.toString('utf8', start, start + subSize).replace(/\0/g, ''));
      }
      sub = start + subSize;
    }
    pos += 24 + dataSize;
  }
  return texts;
};

const patch = (
  subrecord: string,
  occurrence: number,
  oldText: string,
  newText: string,
): EspPatch => ({
  formId: '000A0F1C',
  subrecord,
  oldText,
  occurrence,
  newText,
});

// Vault 111 Overseer's Terminal: five menu items interleaved with body text.
const overseerTerminal = (compress = false): Buffer =>
  buildPlugin([
    buildRecord(
      'TERM',
      0x000a0f1c,
      [
        zstring('EDID', 'V111OverseerTerminal'),
        zstring('FULL', "Overseer's Terminal"),
        zstring('ITXT', 'VAULT 111 OVERSEER INSTRUCTIONS'),
        zstring('UNAM', 'CONFIDENTIAL'),
        zstring('ITXT', 'Cryolator'),
        zstring('UNAM', 'I have long dreamed...'),
        zstring('ITXT', 'Operations Protocol Manual'),
        zstring('ITXT', "Overseer's Log"),
        zstring('ITXT', 'Open Evacuation Tunnel'),
        zstring('RNAM', 'Opening Evacuation Tunnel...'),
      ],
      compress,
    ),
  ]);

const menuPatches: EspPatch[] = [
  patch('ITXT', 0, 'VAULT 111 OVERSEER INSTRUCTIONS', 'ІНСТРУКЦІЇ КЕРІВНИКА СХОВИЩА 111'),
  patch('ITXT', 1, 'Cryolator', 'Кріолятор'),
  patch('ITXT', 2, 'Operations Protocol Manual', 'Посібник з операційних протоколів'),
  patch('ITXT', 3, "Overseer's Log", 'Журнал наглядача'),
  patch('ITXT', 4, 'Open Evacuation Tunnel', 'Відкрити евакуаційний тунель'),
];

const expectedMenu = [
  'ІНСТРУКЦІЇ КЕРІВНИКА СХОВИЩА 111',
  'Кріолятор',
  'Посібник з операційних протоколів',
  'Журнал наглядача',
  'Відкрити евакуаційний тунель',
];

describe('patchEsp — repeated subrecords', () => {
  it('gives every repeated subrecord its own translation', () => {
    const patched = patchEsp(overseerTerminal(), menuPatches);

    expect(readTexts(patched, 'ITXT')).toEqual(expectedMenu);
    expect(readTexts(patched, 'UNAM')).toEqual(['CONFIDENTIAL', 'I have long dreamed...']);
  });

  it('patches repeated subrecords inside compressed records', () => {
    const patched = patchEsp(overseerTerminal(true), menuPatches);

    expect(readTexts(patched, 'ITXT')).toEqual(expectedMenu);
  });

  it('leaves untranslated occurrences untouched', () => {
    const patched = patchEsp(overseerTerminal(), [menuPatches[1], menuPatches[4]]);

    expect(readTexts(patched, 'ITXT')).toEqual([
      'VAULT 111 OVERSEER INSTRUCTIONS',
      'Кріолятор',
      'Operations Protocol Manual',
      "Overseer's Log",
      'Відкрити евакуаційний тунель',
    ]);
  });

  it('keeps order when several occurrences share the same source text', () => {
    const plugin = buildPlugin([
      buildRecord('TERM', 0x000a0f1c, [
        zstring('ITXT', 'Back'),
        zstring('ITXT', 'Back'),
        zstring('ITXT', 'Exit'),
      ]),
    ]);

    const patched = patchEsp(plugin, [
      patch('ITXT', 0, 'Back', 'Назад до головного меню'),
      patch('ITXT', 1, 'Back', 'Назад'),
      patch('ITXT', 2, 'Exit', 'Вихід'),
    ]);

    expect(readTexts(patched, 'ITXT')).toEqual(['Назад до головного меню', 'Назад', 'Вихід']);
  });

  it('falls back to the recorded position when source text drifted', () => {
    const plugin = buildPlugin([
      buildRecord('TERM', 0x000a0f1c, [
        zstring('ITXT', 'Cryolator Prototype'),
        zstring('ITXT', 'Open Evacuation Tunnel'),
      ]),
    ]);

    const patched = patchEsp(plugin, [
      patch('ITXT', 0, 'Cryolator', 'Кріолятор'),
      patch('ITXT', 1, 'Open Evacuation Tunnel', 'Відкрити евакуаційний тунель'),
    ]);

    expect(readTexts(patched, 'ITXT')).toEqual(['Кріолятор', 'Відкрити евакуаційний тунель']);
  });

  it('skips INNR placeholder WNAM entries when numbering occurrences', () => {
    const plugin = buildPlugin([
      buildRecord('INNR', 0x000a0f1c, [
        zstring('WNAM', 'Powerful'),
        zstring('WNAM', '*'),
        zstring('WNAM', 'Combat Rifle'),
      ]),
    ]);

    const patched = patchEsp(plugin, [
      patch('WNAM', 0, 'Powerful', 'Потужний'),
      patch('WNAM', 1, 'Combat Rifle', 'Бойова гвинтівка'),
    ]);

    expect(readTexts(patched, 'WNAM')).toEqual(['Потужний', '*', 'Бойова гвинтівка']);
  });
});

describe('parseSubrecordPath', () => {
  it('reads plain and indexed subrecord paths', () => {
    expect(parseSubrecordPath('TERM\\ITXT')).toEqual({ subrecord: 'ITXT', index: undefined });
    expect(parseSubrecordPath('INNR\\WNAM[2]')).toEqual({ subrecord: 'WNAM', index: 2 });
  });

  it('ignores paths that are not plugin subrecords', () => {
    expect(parseSubrecordPath('PEX\\ClubFusionElevatorScript')).toBeNull();
    expect(parseSubrecordPath('')).toBeNull();
    expect(parseSubrecordPath(null)).toBeNull();
  });
});
