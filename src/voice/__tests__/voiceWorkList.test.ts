import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import { findMasterBackedTake, loadVoiceWorkList } from '../voiceWorkList';

const PATCH_ID = 116;
const MASTER_ID = 33;

const subrecord = (sig: string, text: string): Buffer => {
  const data = Buffer.from(`${text}\0`, 'utf8');
  const header = Buffer.alloc(6);
  header.write(sig, 0, 'ascii');
  header.writeUInt16LE(data.length, 4);
  return Buffer.concat([header, data]);
};

const writePlugin = (file: string, masters: string[]): void => {
  const data = Buffer.concat([
    subrecord('CNAM', 'Author'),
    ...masters.map((m) => subrecord('MAST', m)),
  ]);
  const header = Buffer.alloc(24);
  header.write('TES4', 0, 'ascii');
  header.writeUInt32LE(data.length, 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, data]));
};

const touch = (file: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
};

type Row = Record<string, unknown>;

const tr = (
  line_key: string,
  info_formid_hex: string,
  voice_ordinal: number,
  source: string,
  translation: string,
  string_id: number,
): Row => ({
  line_key,
  info_formid_hex,
  voice_ordinal,
  string_id,
  translation_id: string_id + 1000,
  status: 'reviewed',
  translation,
  source,
  edid: null,
});

const src = (r: Row): Row => ({
  line_key: r.line_key,
  info_formid_hex: r.info_formid_hex,
  voice_ordinal: r.voice_ordinal,
  string_id: r.string_id,
  source: r.source,
  edid: r.edid,
});

describe('voice work list', () => {
  let tmp: string;
  let masterPlugin: string;
  let patchPlugin: string;
  let masterDir: string;
  let patchDir: string;

  const masterRows: Row[] = [
    tr('012345', '00012345', 1, 'Hello there.', 'Привіт.', 1),
    tr('012345', '00012345', 2, 'Second.', 'Друге.', 2),
    tr('000777', '00000777', 1, 'Stay back.', 'Назад.', 3),
  ];
  const patchRows: Row[] = [
    tr('012345', '00012345', 1, 'Hello there!', 'Привіт!', 11),
    tr('012345', '00012345', 2, 'Second.', 'Друге.', 12),
    tr('000777', '00000777', 1, 'Stay back, now.', 'Назад, кажу.', 13),
    tr('016D03', '01016D03', 1, 'Trade.', 'Торгувати.', 14),
  ];

  const makeDb = (opts: { masterImported: boolean }): Tx => {
    const pluginOf: Record<number, string> = { [PATCH_ID]: patchPlugin, [MASTER_ID]: masterPlugin };
    const rowsOf = (id: number, kind: 'tr' | 'src'): Row[] => {
      const rows = id === MASTER_ID ? masterRows : id === PATCH_ID ? patchRows : [];
      return kind === 'tr' ? rows : rows.map(src);
    };
    return {
      query: async (sql: string, params: unknown[] = []) => {
        if (/WHERE id = \$1/.test(sql)) {
          return { rows: [{ abs_path: pluginOf[params[0] as number] ?? null }] };
        }
        if (/RNAM|NOT EXISTS/.test(sql)) return { rows: [] };
        if (/FROM mods/.test(sql) && /abs_path IS NOT NULL/.test(sql)) {
          return {
            rows: opts.masterImported
              ? [{ id: MASTER_ID, name: 'Fallout4', abs_path: masterPlugin }]
              : [],
          };
        }
        if (/JOIN translations t/.test(sql)) return { rows: rowsOf(params[0] as number, 'tr') };
        if (/NAM1|INFO/.test(sql) || /strings s/.test(sql)) {
          return { rows: rowsOf(params[0] as number, 'src') };
        }
        throw new Error(`unexpected query: ${sql}`);
      },
    } as unknown as Tx;
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-worklist-'));
    masterDir = path.join(tmp, 'master');
    patchDir = path.join(tmp, 'patch');
    masterPlugin = path.join(masterDir, 'Fallout4.esm');
    patchPlugin = path.join(patchDir, 'unofficial fallout 4 patch.esp');
    writePlugin(masterPlugin, []);
    writePlugin(patchPlugin, ['Fallout4.esm']);

    const mv = path.join(masterDir, 'Sound', 'Voice', 'Fallout4.esm');
    touch(path.join(mv, 'MaleRough', '00012345_1.fuz'));
    touch(path.join(mv, 'MaleRough', '00012345_2.fuz'));
    touch(path.join(mv, 'FemaleBoston', '00012345_1.fuz'));
    touch(path.join(mv, 'MaleRough', '00000777_1.fuz'));

    const pv = path.join(patchDir, 'Sound', 'Voice');
    touch(path.join(pv, 'Fallout4.esm', 'MaleRough', '00000777_1.fuz'));
    touch(path.join(pv, 'Unofficial Fallout 4 Patch.esp', 'PlayerVoiceFemale01', '00016D03_1.fuz'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const input = () => ({
    modId: PATCH_ID,
    packageDir: patchDir,
    pluginPath: patchPlugin,
    srcLang: 'en',
    tgtLang: 'uk',
  });

  describe('loadVoiceWorkList', () => {
    it('pairs own takes and lends master takes whose translation changed', async () => {
      const list = await loadVoiceWorkList(makeDb({ masterImported: true }), input());
      expect(list.ownOrigin).toBe('unofficial fallout 4 patch.esp');

      const own = list.items.find((i) => i.entry.fileName === '00016D03_1.fuz');
      expect(own?.entry.relPath).toBe(
        'Sound/Voice/Unofficial Fallout 4 Patch.esp/PlayerVoiceFemale01/00016D03_1.fuz',
      );
      expect(own?.masterBacked).toBeNull();
      expect(own?.row.translation).toBe('Торгувати.');

      const fix = list.items.find((i) => i.entry.fileName === '00000777_1.fuz');
      expect(fix?.masterBacked).toBeNull();
      expect(fix?.entry.absolutePath.startsWith(patchDir)).toBe(true);
      expect(fix?.row.translation).toBe('Назад, кажу.');
      // The patch's own take shadows the master's for the same speaker.
      expect(list.items.filter((i) => i.entry.fileName === '00000777_1.fuz')).toHaveLength(1);

      const backed = list.items.filter((i) => i.entry.lineKey === '012345');
      expect(backed.map((i) => i.entry.variant)).toEqual([1, 1]);
      expect(backed.map((i) => path.basename(path.dirname(i.entry.absolutePath))).sort()).toEqual([
        'FemaleBoston',
        'MaleRough',
      ]);
      for (const item of backed) {
        expect(item.entry.absolutePath.startsWith(masterDir)).toBe(true);
        expect(item.masterBacked?.master.modId).toBe(MASTER_ID);
        expect(item.referenceSource).toBe('Hello there.');
        expect(item.row.translation).toBe('Привіт!');
        expect(list.masterOfEntry(item.entry)).toBe(item.masterBacked);
      }
      expect(list.masterOfEntry(own!.entry)).toBeNull();

      expect(list.items).toHaveLength(4);
      expect(list.voiceFiles).toHaveLength(2);
    });

    it('counts lines whose translation equals the master as same-as-master', async () => {
      const list = await loadVoiceWorkList(makeDb({ masterImported: true }), input());
      expect(list.items.some((i) => i.entry.variant === 2)).toBe(false);
      expect(list.skipped).toHaveLength(1);
      expect(list.skipped[0]).toContain('same as master');
      expect(list.skipped[0]).toContain('1 takes');
    });

    it('prepends the prefix to reported messages', async () => {
      const list = await loadVoiceWorkList(makeDb({ masterImported: true }), {
        ...input(),
        prefix: 'pkg/',
      });
      expect(list.skipped[0]!.startsWith('pkg/')).toBe(true);
    });

    it('merges patch and master voice sources', async () => {
      const list = await loadVoiceWorkList(makeDb({ masterImported: true }), input());
      expect(list.voiceSources.get('fallout4.esm/012345:1')?.source).toBe('Hello there!');
      expect(list.voiceSources.get('fallout4.esm/012345:2')?.source).toBe('Second.');
      expect(list.voiceSources.get('unofficial fallout 4 patch.esp/016D03:1')?.source).toBe(
        'Trade.',
      );
      expect(list.voiceSources.has('fallout4.esm/000777:1')).toBe(true);
    });

    it('siblingsOf pools a speaker across the mod and its lent masters', async () => {
      const list = await loadVoiceWorkList(makeDb({ masterImported: true }), input());
      const backed = list.items.find(
        (i) => i.masterBacked && i.entry.relPath.includes('/MaleRough/'),
      )!;
      const sibs = list.siblingsOf('MaleRough', backed.entry);
      expect(sibs.length).toBeGreaterThan(0);
      expect(sibs.some((s) => s.fileName === backed.entry.fileName)).toBe(false);
      // A reference picked in the editor may be any of these, so every take must see them.
      expect(
        sibs
          .filter((s) => s.absolutePath.startsWith(masterDir))
          .map((s) => s.fileName)
          .sort(),
      ).toEqual(['00000777_1.fuz', '00012345_2.fuz']);

      const own = list.items.find((i) => i.entry.fileName === '00016D03_1.fuz')!;
      expect(list.siblingsOf('PlayerVoiceFemale01', own.entry)).toEqual([]);
    });

    it("places a borrowed take in the patch's own voice tree, Data/ folder included", async () => {
      const dataPackage = path.join(tmp, 'patch-data');
      patchPlugin = path.join(dataPackage, 'Data', 'unofficial fallout 4 patch.esp');
      writePlugin(patchPlugin, ['Fallout4.esm']);

      const list = await loadVoiceWorkList(makeDb({ masterImported: true }), {
        ...input(),
        packageDir: dataPackage,
        pluginPath: patchPlugin,
      });

      const backed = list.items.filter((i) => i.masterBacked);
      expect(backed.map((i) => i.entry.relPath)).toContain(
        'Data/Sound/Voice/Fallout4.esm/MaleRough/00012345_1.fuz',
      );
      // The audio to clone is still the master's file.
      expect(backed.every((i) => i.entry.absolutePath.startsWith(masterDir))).toBe(true);
    });

    it('skips master lines when the master is not imported', async () => {
      const list = await loadVoiceWorkList(makeDb({ masterImported: false }), input());
      expect(list.items.every((i) => i.masterBacked === null)).toBe(true);
      expect(list.items.map((i) => i.entry.fileName).sort()).toEqual([
        '00000777_1.fuz',
        '00016D03_1.fuz',
      ]);
      expect(list.skipped.some((s) => s.includes('not imported'))).toBe(true);
      expect(list.skipped.some((s) => s.includes('same as master'))).toBe(false);
    });
  });

  describe('findMasterBackedTake', () => {
    const find = (over: Record<string, unknown>) =>
      findMasterBackedTake(makeDb({ masterImported: true }), {
        modId: PATCH_ID,
        pluginPath: patchPlugin,
        originPlugin: 'fallout4.esm',
        lineKey: '012345',
        variant: 1,
        srcLang: 'en',
        tgtLang: 'uk',
        ...over,
      });

    it('finds the master take of the requested speaker', async () => {
      const hit = await find({ speakerKey: 'FemaleBoston' });
      expect(hit).not.toBeNull();
      expect(hit!.entry.relPath).toContain('/FemaleBoston/');
      expect(hit!.context.master.modId).toBe(MASTER_ID);
      expect(hit!.referenceSource).toBe('Hello there.');
      expect(hit!.masterTranslation).toBe('Привіт.');
    });

    it('takes any speaker when none is requested', async () => {
      const hit = await find({});
      expect(hit).not.toBeNull();
      expect(hit!.entry.lineKey).toBe('012345');
    });

    it('returns null for an unknown speaker or origin', async () => {
      expect(await find({ speakerKey: 'Nobody' })).toBeNull();
      expect(await find({ originPlugin: 'dlcrobot.esm' })).toBeNull();
      expect(await find({ originPlugin: '' })).toBeNull();
    });

    it('returns null when the master is not imported', async () => {
      const hit = await findMasterBackedTake(makeDb({ masterImported: false }), {
        modId: PATCH_ID,
        pluginPath: patchPlugin,
        originPlugin: 'fallout4.esm',
        lineKey: '012345',
        variant: 1,
        srcLang: 'en',
        tgtLang: 'uk',
      });
      expect(hit).toBeNull();
    });
  });
});
