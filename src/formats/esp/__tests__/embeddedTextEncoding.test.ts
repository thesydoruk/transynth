/**
 * Text embedded in a plugin that is not localized: an English plugin stores
 * Windows-1252 bytes, a translated one UTF-8. Both must read as the same letters
 * in the import walk, the actor and quest indexes and the export patcher.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from '@jest/globals';
import { STARFIELD_RECORD_LAYOUT } from '../../../games/creation-engine/import/recordLayouts';
import type { TranslatableSubrecords } from '../../subrecords';
import { EspReader } from '../EspReader';
import { patchEsp } from '../espPatcher';
import { grup, plugin, record, sub, zstring } from './pluginBytes';

const TEXT: Record<string, readonly string[]> = {
  BOOK: ['FULL', 'DESC'],
  INNR: ['WNAM'],
  NPC_: ['FULL'],
  QUST: ['FULL', 'CNAM'],
};
const subrecords: TranslatableSubrecords = {
  isIgnoredRecord: () => false,
  isTranslatable: (rec, field) => TEXT[rec]?.includes(field) ?? false,
};

/** A zero-terminated string in the bytes an English plugin holds. */
const cp1252 = (sig: string, text: string): Buffer => sub(sig, Buffer.from(`${text}\0`, 'latin1'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'esp-encoding-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const pluginBytes = (): Buffer =>
  plugin([
    grup('BOOK', 0, [
      record('BOOK', 0x00000a01, [
        zstring('EDID', 'RecipeBook'),
        cp1252('FULL', 'Recipe for Caf\xe9 et Th\xe9 Prime'),
        cp1252('DESC', '\xc0 bient\xf4t. Heller\x92s log \x96 part 1'),
      ]),
      record('BOOK', 0x00000a02, [
        zstring('EDID', 'TranslatedBook'),
        zstring('FULL', 'Журнал Геллера'),
      ]),
    ]),
    grup('INNR', 0, [
      record('INNR', 0x00000a10, [zstring('EDID', 'Names'), cp1252('WNAM', 'Flamb\xe9ed')]),
    ]),
    grup('NPC_', 0, [
      record('NPC_', 0x00000a20, [
        zstring('EDID', 'Bonifac'),
        cp1252('FULL', 'Bonif\xe1c Maksimov'),
      ]),
    ]),
    grup('QUST', 0, [
      record('QUST', 0x00000a30, [
        zstring('EDID', 'Quest'),
        cp1252('FULL', 'Fran\xe7ois\x92s Favor'),
        cp1252('CNAM', 'Find Bonif\xe1c.'),
        cp1252('CNAM', 'Bonif\xe1c is dead.'),
      ]),
    ]),
  ]);

const reader = (): EspReader => {
  const file = path.join(tmp, 'Embedded.esp');
  fs.writeFileSync(file, pluginBytes());
  return new EspReader(file, subrecords, STARFIELD_RECORD_LAYOUT);
};

describe('text embedded in a plugin', () => {
  it('reads Windows-1252 text and leaves UTF-8 text as it is', () => {
    const rows = reader().extractStrings();
    expect(rows.map((row) => [row.formId, row.path, row.text])).toEqual([
      ['00000A01', 'FULL', 'Recipe for Café et Thé Prime'],
      ['00000A01', 'DESC', 'À bientôt. Heller’s log – part 1'],
      ['00000A02', 'FULL', 'Журнал Геллера'],
      ['00000A10', 'WNAM[0]', 'Flambéed'],
      ['00000A20', 'FULL', 'Bonifác Maksimov'],
      ['00000A30', 'FULL', 'François’s Favor'],
      ['00000A30', 'CNAM', 'Find Bonifác.'],
      ['00000A30', 'CNAM', 'Bonifác is dead.'],
    ]);
  });

  it('names actors and quests with the same letters', () => {
    const esp = reader();
    expect(esp.extractActorIndex().actors.map((actor) => actor.nameText)).toEqual([
      'Bonifác Maksimov',
    ]);
    expect(esp.extractDialogStructure().quests.map((quest) => quest.name)).toEqual([
      'François’s Favor',
    ]);
  });

  it('places a translation by the source text the import stored', () => {
    // The recorded position points at the first log entry; only the stored text
    // says the second one is meant.
    const patched = patchEsp(pluginBytes(), [
      {
        formId: '00000A30',
        subrecord: 'CNAM',
        occurrence: 0,
        oldText: 'Bonifác is dead.',
        newText: 'Боніфац мертвий.',
      },
    ]);
    const file = path.join(tmp, 'Patched.esp');
    fs.writeFileSync(file, patched);
    const rows = new EspReader(file, subrecords, STARFIELD_RECORD_LAYOUT).extractStrings();
    expect(rows.filter((row) => row.path === 'CNAM').map((row) => row.text)).toEqual([
      'Find Bonifác.',
      'Боніфац мертвий.',
    ]);
  });
});
