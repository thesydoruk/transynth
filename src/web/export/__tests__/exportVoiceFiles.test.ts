import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { modImportLocalizeDir, modStorageRoot } from '../../../modStorage';
import { collectLocalizedVoiceFiles } from '../exportVoiceFiles';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('collectLocalizedVoiceFiles', () => {
  it('collects localized .fuz files under Sound/Voice with install-relative paths', () => {
    const extractRoot = path.join(modStorageRoot(), `_extracted_voice_${Date.now()}`);
    tempDirs.push(extractRoot);
    fs.mkdirSync(extractRoot, { recursive: true });

    const pluginPath = path.join(extractRoot, 'MyMod.esp');
    fs.writeFileSync(pluginPath, Buffer.from('TES4', 'ascii'));

    const localizeDir = modImportLocalizeDir(extractRoot, 'uk');
    const voicePath = path.join(
      localizeDir,
      'Sound',
      'Voice',
      'MyMod.esp',
      'NPCMExample',
      '00123456_1.fuz',
    );
    fs.mkdirSync(path.dirname(voicePath), { recursive: true });
    fs.writeFileSync(voicePath, Buffer.from('fake-fuz'));

    const files = collectLocalizedVoiceFiles(pluginPath, 'uk');
    expect(files).toEqual([
      {
        name: 'Sound/Voice/MyMod.esp/NPCMExample/00123456_1.fuz',
        packageRel: 'Sound/Voice/MyMod.esp/NPCMExample/00123456_1.fuz',
        absPath: voicePath,
      },
    ]);
  });

  it('prefixes package folder for plugins under Data/', () => {
    const extractRoot = path.join(modStorageRoot(), `_extracted_voice_data_${Date.now()}`);
    tempDirs.push(extractRoot);
    fs.mkdirSync(extractRoot, { recursive: true });

    const pluginPath = path.join(extractRoot, 'Data', 'MyMod.esp');
    fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
    fs.writeFileSync(pluginPath, Buffer.from('TES4', 'ascii'));

    const localizeDir = modImportLocalizeDir(extractRoot, 'uk');
    const voicePath = path.join(
      localizeDir,
      'Data',
      'Sound',
      'Voice',
      'MyMod.esp',
      '00123456_1.fuz',
    );
    fs.mkdirSync(path.dirname(voicePath), { recursive: true });
    fs.writeFileSync(voicePath, Buffer.from('fake-fuz'));

    const files = collectLocalizedVoiceFiles(pluginPath, 'uk');
    expect(files).toEqual([
      {
        name: 'Data/Sound/Voice/MyMod.esp/00123456_1.fuz',
        packageRel: 'Data/Sound/Voice/MyMod.esp/00123456_1.fuz',
        absPath: voicePath,
      },
    ]);
  });

  it('keeps only clips whose FormID is in the exportable allowlist', () => {
    const extractRoot = path.join(modStorageRoot(), `_extracted_voice_filter_${Date.now()}`);
    tempDirs.push(extractRoot);
    fs.mkdirSync(extractRoot, { recursive: true });

    const pluginPath = path.join(extractRoot, 'MyMod.esp');
    fs.writeFileSync(pluginPath, Buffer.from('TES4', 'ascii'));

    const localizeDir = modImportLocalizeDir(extractRoot, 'uk');
    const voiceDir = path.join(localizeDir, 'Sound', 'Voice', 'MyMod.esp', 'NPC');
    fs.mkdirSync(voiceDir, { recursive: true });
    const keepPath = path.join(voiceDir, '00123456_1.fuz');
    const skipPath = path.join(voiceDir, '000219CF_1.fuz');
    const junkPath = path.join(voiceDir, 'extra.fuz');
    fs.writeFileSync(keepPath, Buffer.from('keep'));
    fs.writeFileSync(skipPath, Buffer.from('skip'));
    fs.writeFileSync(junkPath, Buffer.from('junk'));

    const files = collectLocalizedVoiceFiles(pluginPath, 'uk', {
      exportableKeys: new Set(['mymod.esp/123456:1']),
    });
    expect(files.map((file) => file.name)).toEqual(['Sound/Voice/MyMod.esp/NPC/00123456_1.fuz']);
  });

  it('exports a patch take written under its master origin only for the master-origin key', () => {
    const extractRoot = path.join(modStorageRoot(), `_extracted_voice_origin_${Date.now()}`);
    tempDirs.push(extractRoot);
    fs.mkdirSync(extractRoot, { recursive: true });

    const pluginPath = path.join(extractRoot, 'Unofficial Fallout 4 Patch.esp');
    fs.writeFileSync(pluginPath, Buffer.from('TES4', 'ascii'));

    const localizeDir = modImportLocalizeDir(extractRoot, 'uk');
    const takePath = path.join(
      localizeDir,
      'Sound',
      'Voice',
      'Fallout4.esm',
      'MaleRough',
      '00012345_1.fuz',
    );
    fs.mkdirSync(path.dirname(takePath), { recursive: true });
    fs.writeFileSync(takePath, Buffer.from('take'));

    const kept = collectLocalizedVoiceFiles(pluginPath, 'uk', {
      exportableKeys: new Set(['fallout4.esm/012345:1']),
    });
    expect(kept.map((file) => file.name)).toEqual([
      'Sound/Voice/Fallout4.esm/MaleRough/00012345_1.fuz',
    ]);

    const dropped = collectLocalizedVoiceFiles(pluginPath, 'uk', {
      exportableKeys: new Set(['unofficial fallout 4 patch.esp/012345:1']),
    });
    expect(dropped).toEqual([]);
  });
});
