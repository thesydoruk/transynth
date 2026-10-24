import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dedupeVoiceFiles, discoverVoiceFiles, type VoiceFileEntry } from '../discoverVoiceFiles';

const entry = (
  speaker: string,
  formid: string,
  variant: number,
  ext: VoiceFileEntry['ext'] = 'fuz',
): VoiceFileEntry => ({
  relPath: `Sound/Voice/Fallout4.esm/${speaker}/${formid}_${variant}.${ext}`,
  absolutePath: `/data/${speaker}/${formid}_${variant}.${ext}`,
  fileName: `${formid}_${variant}.${ext}`,
  lineKey: formid.substring(2).toUpperCase(),
  variant,
  ext,
});

describe('dedupeVoiceFiles', () => {
  it('keeps Nate and Nora takes of the same INFO FormID', () => {
    const kept = dedupeVoiceFiles([
      entry('PlayerVoiceMale01', '00005825', 1),
      entry('PlayerVoiceFemale01', '00005825', 1),
    ]);

    expect(kept.map((row) => row.relPath).sort()).toEqual([
      'Sound/Voice/Fallout4.esm/PlayerVoiceFemale01/00005825_1.fuz',
      'Sound/Voice/Fallout4.esm/PlayerVoiceMale01/00005825_1.fuz',
    ]);
  });

  it('still prefers fuz over wav inside one speaker folder', () => {
    const kept = dedupeVoiceFiles([
      entry('PlayerVoiceMale01', '00005825', 1, 'wav'),
      entry('PlayerVoiceMale01', '00005825', 1, 'fuz'),
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0]?.ext).toBe('fuz');
  });
});

describe('discoverVoiceFiles', () => {
  it('walks every origin folder next to the plugin and tags each take', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-voice-'));
    try {
      const voice = path.join(root, 'Data', 'Sound', 'Voice');
      const own = path.join(voice, 'Unofficial Fallout 4 Patch.esp', 'PlayerVoiceFemale01');
      const master = path.join(voice, 'Fallout4.esm', 'MaleRough');
      fs.mkdirSync(own, { recursive: true });
      fs.mkdirSync(master, { recursive: true });
      fs.writeFileSync(path.join(own, '00016D03_1.fuz'), 'x');
      fs.writeFileSync(path.join(master, '0019EE0C_1.fuz'), 'x');
      fs.writeFileSync(path.join(master, 'readme.txt'), 'x');

      const found = discoverVoiceFiles(root, 'Data/unofficial fallout 4 patch.esp');

      expect(found.map((e) => [e.relPath, e.originPlugin, e.lineKey, e.variant])).toEqual([
        ['Data/Sound/Voice/Fallout4.esm/MaleRough/0019EE0C_1.fuz', 'fallout4.esm', '19EE0C', 1],
        [
          'Data/Sound/Voice/Unofficial Fallout 4 Patch.esp/PlayerVoiceFemale01/00016D03_1.fuz',
          'unofficial fallout 4 patch.esp',
          '016D03',
          1,
        ],
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("walks only the plugin's own folder and its masters' when the plugin can be read", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-voice-'));
    try {
      // A TES4 header naming Fallout4.esm as the only master.
      const mast = Buffer.from('Fallout4.esm\0', 'utf8');
      const sub = Buffer.alloc(6);
      sub.write('MAST', 0, 'ascii');
      sub.writeUInt16LE(mast.length, 4);
      const record = Buffer.alloc(24);
      record.write('TES4', 0, 'ascii');
      record.writeUInt32LE(sub.length + mast.length, 4);
      fs.mkdirSync(path.join(root, 'Data'), { recursive: true });
      fs.writeFileSync(path.join(root, 'Data', 'Patch.esp'), Buffer.concat([record, sub, mast]));

      const voice = path.join(root, 'Data', 'Sound', 'Voice');
      for (const folder of ['Patch.esp', 'Fallout4.esm', 'DLCCoast.esm']) {
        fs.mkdirSync(path.join(voice, folder, 'MaleRough'), { recursive: true });
        fs.writeFileSync(path.join(voice, folder, 'MaleRough', '00016D03_1.fuz'), 'x');
      }

      const found = discoverVoiceFiles(root, 'Data/Patch.esp');

      expect(found.map((e) => e.originPlugin)).toEqual(['fallout4.esm', 'patch.esp']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns nothing when there is no voice tree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-voice-'));
    try {
      expect(discoverVoiceFiles(root, 'Data/Mod.esp')).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
