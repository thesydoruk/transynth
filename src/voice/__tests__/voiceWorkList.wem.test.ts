import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import { _resetInfoVoiceResponseCacheForTests } from '../infoResponseNumbers';
import { wemFfxanimTakes } from '../takeFormat';
import { findMasterBackedTake, loadVoiceWorkList } from '../voiceWorkList';
import { touch, wemInfo, writePlugin } from './wemFixtures';

const PATCH_ID = 116;
const MASTER_ID = 33;

type Row = Record<string, unknown>;

const tr = (
  info_formid_hex: string,
  voice_ordinal: number,
  source: string,
  translation: string,
  string_id: number,
): Row => ({
  line_key: info_formid_hex.slice(2),
  info_formid_hex,
  voice_ordinal,
  string_id,
  translation_id: string_id + 1000,
  status: 'reviewed',
  translation,
  source,
  edid: null,
});

/**
 * The patch work list of `voiceWorkList.test.ts`, for a title whose takes are
 * named by WEM id: the same pairing, with the file names read out of each
 * plugin's own records.
 */
describe('voice work list with takes named by WEM id', () => {
  const takes = wemFfxanimTakes('opus');
  let tmp: string;
  let masterPlugin: string;
  let patchPlugin: string;
  let masterDir: string;
  let patchDir: string;

  const masterRows: Row[] = [
    tr('00012345', 1, 'Hello there.', 'Привіт.', 1),
    tr('00012345', 2, 'Second.', 'Друге.', 2),
    tr('00000777', 1, 'Stay back.', 'Назад.', 3),
  ];
  const patchRows: Row[] = [
    tr('00012345', 1, 'Hello there!', 'Привіт!', 11),
    tr('00012345', 2, 'Second.', 'Друге.', 12),
    tr('00000777', 1, 'Stay back, now.', 'Назад, кажу.', 13),
    tr('01000800', 1, 'Trade.', 'Торгувати.', 14),
  ];

  const db = (): Tx => {
    const pluginOf: Record<number, string> = { [PATCH_ID]: patchPlugin, [MASTER_ID]: masterPlugin };
    const rowsOf = (id: number): Row[] =>
      id === MASTER_ID ? masterRows : id === PATCH_ID ? patchRows : [];
    return {
      query: async (sql: string, params: unknown[] = []) => {
        if (/WHERE id = \$1/.test(sql)) {
          return { rows: [{ abs_path: pluginOf[params[0] as number] ?? null }] };
        }
        if (/RNAM|NOT EXISTS/.test(sql)) return { rows: [] };
        if (/FROM mods/.test(sql) && /abs_path IS NOT NULL/.test(sql)) {
          return { rows: [{ id: MASTER_ID, name: 'Starfield', abs_path: masterPlugin }] };
        }
        if (/JOIN translations t/.test(sql) || /NAM1|INFO/.test(sql) || /strings s/.test(sql)) {
          return { rows: rowsOf(params[0] as number) };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    } as unknown as Tx;
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-worklist-wem-'));
    masterDir = path.join(tmp, 'master');
    patchDir = path.join(tmp, 'patch');
    masterPlugin = path.join(masterDir, 'Starfield.esm');
    patchPlugin = path.join(patchDir, 'Patch.esm');

    writePlugin(
      masterPlugin,
      [],
      [
        wemInfo(0x00012345, [
          { wemId: 0xa1, text: 'Hello there.' },
          { wemId: 0xa2, text: 'Second.' },
        ]),
        wemInfo(0x00000777, [{ wemId: 0xb1, text: 'Stay back.' }]),
      ],
    );
    // The patch re-numbers the first response of the line it rewrites.
    writePlugin(
      patchPlugin,
      ['Starfield.esm'],
      [
        wemInfo(0x00012345, [
          { wemId: 0xa9, text: 'Hello there!' },
          { wemId: 0xa2, text: 'Second.' },
        ]),
        wemInfo(0x00000777, [{ wemId: 0xb1, text: 'Stay back, now.' }]),
        wemInfo(0x01000800, [{ wemId: 0xc1, text: 'Trade.' }]),
      ],
    );

    const mv = path.join(masterDir, 'Sound', 'Voice', 'Starfield.esm');
    touch(path.join(mv, 'NPCMBarrett', '000000a1.wem'));
    touch(path.join(mv, 'NPCMBarrett', '000000a2.wem'));
    touch(path.join(mv, 'NPCFAndreja', '000000a1.wem'));
    touch(path.join(mv, 'NPCMBarrett', '000000b1.wem'));

    const pv = path.join(patchDir, 'Sound', 'Voice');
    touch(path.join(pv, 'Starfield.esm', 'NPCMBarrett', '000000b1.wem'));
    touch(path.join(pv, 'Patch.esm', 'NPCFAndreja', '000000c1.wem'));
  });

  afterEach(() => {
    _resetInfoVoiceResponseCacheForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const input = () => ({
    modId: PATCH_ID,
    packageDir: patchDir,
    pluginPath: patchPlugin,
    srcLang: 'en',
    tgtLang: 'uk',
    takes,
  });

  it('pairs own takes with their lines through the plugin', async () => {
    const list = await loadVoiceWorkList(db(), input());
    expect(list.voiceFiles.map((entry) => entry.fileName).sort()).toEqual([
      '000000b1.wem',
      '000000c1.wem',
    ]);

    const own = list.items.find((item) => item.entry.fileName === '000000c1.wem');
    expect([own?.entry.lineKey, own?.entry.variant, own?.row.translation]).toEqual([
      '000800',
      1,
      'Торгувати.',
    ]);
    const fix = list.items.find((item) => item.entry.fileName === '000000b1.wem');
    expect(fix?.masterBacked).toBeNull();
    expect(fix?.entry.absolutePath.startsWith(patchDir)).toBe(true);
    expect(fix?.row.translation).toBe('Назад, кажу.');
  });

  it('borrows a master take and writes the dub under the id the patch gives the response', async () => {
    const list = await loadVoiceWorkList(db(), input());
    const backed = list.items.filter((item) => item.entry.lineKey === '012345');

    expect(backed.map((item) => item.entry.relPath).sort()).toEqual([
      'Sound/Voice/Starfield.esm/NPCFAndreja/000000a9.wem',
      'Sound/Voice/Starfield.esm/NPCMBarrett/000000a9.wem',
    ]);
    for (const item of backed) {
      expect(item.entry.fileName).toBe('000000a9.wem');
      // The audio to clone from is still the master's own file.
      expect(path.basename(item.entry.absolutePath)).toBe('000000a1.wem');
      expect(item.entry.absolutePath.startsWith(masterDir)).toBe(true);
      expect(item.masterBacked?.master.modId).toBe(MASTER_ID);
      expect(item.referenceSource).toBe('Hello there.');
      expect(takes.localizedRelPath(item.entry)).toBe(item.entry.relPath);
    }
    // The second response is unchanged: left to the master's pack.
    expect(list.items.some((item) => item.entry.variant === 2)).toBe(false);
    expect(list.items).toHaveLength(4);
  });

  it('finds one borrowed take by line for the editor', async () => {
    const backed = await findMasterBackedTake(db(), {
      ...input(),
      originPlugin: 'Starfield.esm',
      lineKey: '012345',
      variant: 1,
      speakerKey: 'NPCFAndreja',
    });
    expect(backed?.entry.relPath).toBe('Sound/Voice/Starfield.esm/NPCFAndreja/000000a9.wem');
    expect(path.basename(backed!.entry.absolutePath)).toBe('000000a1.wem');
    expect(backed?.referenceSource).toBe('Hello there.');

    // Read as a .fuz title, the master has no such take.
    expect(
      await findMasterBackedTake(db(), {
        ...input(),
        takes: undefined,
        originPlugin: 'Starfield.esm',
        lineKey: '012345',
        variant: 1,
      }),
    ).toBeNull();
  });
});
