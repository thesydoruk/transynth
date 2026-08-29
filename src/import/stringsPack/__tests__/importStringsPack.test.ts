import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { EspStringRow } from '../../../formats/esp';
import {
  buildLstringEspIndex,
  buildStringsPackModName,
  buildStringsPackRows,
  collectPluginStems,
  discoverStringsPacks,
  espRowToCsvRow,
  groupStringsFilesByStem,
  parseStringsFileName,
  resolveStringsTypeForEspRow,
} from '..';

describe('parseStringsFileName', () => {
  it('parses standard Bethesda strings file names', () => {
    expect(parseStringsFileName('fallout4_en.strings')).toEqual({
      stem: 'fallout4',
      locale: 'en',
      type: 'STRINGS',
    });
    expect(parseStringsFileName('dlccoast_en.dlstrings')).toEqual({
      stem: 'dlccoast',
      locale: 'en',
      type: 'DLSTRINGS',
    });
  });

  it('returns null for unrelated files', () => {
    expect(parseStringsFileName('readme.txt')).toBeNull();
  });
});

describe('resolveStringsTypeForEspRow', () => {
  it('maps INFO subrecords per xTranslator fo4 rules', () => {
    expect(
      resolveStringsTypeForEspRow(
        {
          formId: '01001234',
          signature: 'INFO',
          edid: 'MyInfo',
          path: 'NAM1',
          text: '42',
          isLstringId: true,
        },
        'fo4',
      ),
    ).toBe('ILSTRINGS');
    expect(
      resolveStringsTypeForEspRow(
        {
          formId: '01001234',
          signature: 'INFO',
          edid: 'MyInfo',
          path: 'RNAM',
          text: '43',
          isLstringId: true,
        },
        'fo4',
      ),
    ).toBe('STRINGS');
  });

  it('defaults other rows to STRINGS', () => {
    expect(
      resolveStringsTypeForEspRow(
        {
          formId: '01009999',
          signature: 'ARMO',
          edid: 'Armor',
          path: 'FULL',
          text: '7',
          isLstringId: true,
        },
        'fo4',
      ),
    ).toBe('STRINGS');
  });

  it('maps WEAP/DESC to DLSTRINGS', () => {
    expect(
      resolveStringsTypeForEspRow(
        {
          formId: '01009999',
          signature: 'WEAP',
          edid: 'Gun',
          path: 'DESC',
          text: '7',
          isLstringId: true,
        },
        'fo4',
      ),
    ).toBe('DLSTRINGS');
  });
});

describe('buildLstringEspIndex', () => {
  it('indexes rows by strings type and lstring id', () => {
    const rows: EspStringRow[] = [
      {
        formId: '01000001',
        signature: 'INFO',
        edid: 'InfoA',
        path: 'NAM1',
        text: '100',
        isLstringId: true,
      },
      {
        formId: '01000002',
        signature: 'ARMO',
        edid: 'ArmorA',
        path: 'FULL',
        text: '200',
        isLstringId: true,
      },
    ];

    const index = buildLstringEspIndex(rows, 'fo4');
    expect(index.get('ILSTRINGS')?.get(100)).toHaveLength(1);
    expect(index.get('STRINGS')?.get(200)).toHaveLength(1);
  });
});

describe('espRowToCsvRow', () => {
  it('builds identifiable record metadata', () => {
    const row = espRowToCsvRow(
      {
        formId: '01001234',
        signature: 'INFO',
        edid: 'MyDialogLine',
        path: 'NAM1',
        text: '42',
        isLstringId: true,
        dialogTopicFormId: '01005678',
      },
      'Hello',
    );

    expect(row).toMatchObject({
      FormID: '01001234',
      Signature: 'INFO',
      EDID: 'MyDialogLine',
      Path: 'INFO\\NAM1',
      LStringID: 42,
      Source: 'Hello',
      DialogTopicFormID: '01005678',
    });
  });
});

describe('buildStringsPackModName', () => {
  it('uses stem and hash suffix', () => {
    expect(buildStringsPackModName('fallout4', 'abcdef1234567890')).toBe('fallout4__abcdef12');
  });
});

describe('buildStringsPackRows', () => {
  it('creates rows from ESP references instead of bare ids', () => {
    const index = buildLstringEspIndex(
      [
        {
          formId: '01001234',
          signature: 'INFO',
          edid: 'LineA',
          path: 'NAM1',
          text: '42',
          isLstringId: true,
        },
      ],
      'fo4',
    );

    const { rows, mapped, unmapped } = buildStringsPackRows(
      {
        filePath: '/tmp/strings/fallout4_en.ilstrings',
        stem: 'fallout4',
        locale: 'en',
        type: 'ILSTRINGS',
      },
      new Map([
        [42, 'Hello'],
        [99, 'Orphan'],
      ]),
      index,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      FormID: '01001234',
      Signature: 'INFO',
      EDID: 'LineA',
      Path: 'INFO\\NAM1',
      Source: 'Hello',
    });
    expect(mapped).toBe(1);
    expect(unmapped).toBe(1);
  });
});

describe('groupStringsFilesByStem', () => {
  it('merges locales and string types for the same stem', () => {
    const groups = groupStringsFilesByStem([
      {
        filePath: '/tmp/strings/fallout4_en.strings',
        stem: 'fallout4',
        locale: 'en',
        type: 'STRINGS',
      },
      {
        filePath: '/tmp/strings/fallout4_en.dlstrings',
        stem: 'fallout4',
        locale: 'en',
        type: 'DLSTRINGS',
      },
      {
        filePath: '/tmp/strings/fallout4_ru.strings',
        stem: 'fallout4',
        locale: 'ru',
        type: 'STRINGS',
      },
      {
        filePath: '/tmp/strings/dlccoast_en.strings',
        stem: 'dlccoast',
        locale: 'en',
        type: 'STRINGS',
      },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.map((f) => path.basename(f.filePath))).toEqual(['dlccoast_en.strings']);
    expect(groups[1]?.map((f) => path.basename(f.filePath))).toEqual([
      'fallout4_en.dlstrings',
      'fallout4_en.strings',
      'fallout4_ru.strings',
    ]);
  });
});

describe('discoverStringsPacks', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strings-pack-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates one candidate per orphan stem', () => {
    const stringsDir = path.join(tmpDir, 'strings');
    fs.mkdirSync(stringsDir, { recursive: true });
    fs.writeFileSync(path.join(stringsDir, 'fallout4_en.strings'), Buffer.alloc(8));
    fs.writeFileSync(path.join(stringsDir, 'dlccoast_en.strings'), Buffer.alloc(8));

    const packs = discoverStringsPacks(tmpDir);
    expect(packs).toHaveLength(2);
    expect(packs.map((p) => p.stem).sort()).toEqual(['dlccoast', 'fallout4']);
  });

  it('skips strings that have a matching plugin in the tree', () => {
    const stringsDir = path.join(tmpDir, 'strings');
    fs.mkdirSync(stringsDir, { recursive: true });
    fs.writeFileSync(path.join(stringsDir, 'mymod_en.strings'), Buffer.alloc(8));
    fs.writeFileSync(path.join(tmpDir, 'MyMod.esp'), 'PLUGIN');

    expect(collectPluginStems(tmpDir)).toEqual(new Set(['mymod']));
    expect(discoverStringsPacks(tmpDir)).toHaveLength(0);
  });

  it('imports orphan stems even when other plugins exist', () => {
    const stringsDir = path.join(tmpDir, 'strings');
    fs.mkdirSync(stringsDir, { recursive: true });
    fs.writeFileSync(path.join(stringsDir, 'fallout4_en.strings'), Buffer.alloc(8));
    fs.writeFileSync(path.join(stringsDir, 'mymod_en.strings'), Buffer.alloc(8));
    fs.writeFileSync(path.join(tmpDir, 'MyMod.esp'), 'PLUGIN');

    const packs = discoverStringsPacks(tmpDir);
    expect(packs).toHaveLength(1);
    expect(packs[0]?.stem).toBe('fallout4');
  });
});
