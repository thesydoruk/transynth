import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from '@jest/globals';
import { modImportLocalizeDir, modStorageRoot } from '../../../modStorage';
import { _resetInfoVoiceResponseCacheForTests } from '../../../voice/infoResponseNumbers';
import { touch, wemInfo, writePlugin } from '../../../voice/__tests__/wemFixtures';
import { registerWemTestGame } from '../../../voice/__tests__/wemTestGame';
import { collectLocalizedVoiceFiles, localizedVoiceExtensions } from '../exportVoiceFiles';

const tempDirs: string[] = [];

afterEach(() => {
  _resetInfoVoiceResponseCacheForTests();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('collecting localized takes of a title that names them by WEM id', () => {
  const setUp = (): { pluginPath: string; voiceDir: string } => {
    const extractRoot = path.join(modStorageRoot(), `_extracted_wem_voice_${Date.now()}`);
    tempDirs.push(extractRoot);
    const pluginPath = path.join(extractRoot, 'Mod.esm');
    writePlugin(
      pluginPath,
      ['Starfield.esm'],
      [
        wemInfo(0x01000800, [
          { wemId: 0x00ae4a02, text: 'Hello.' },
          { wemId: 0x00ae4a03, text: 'Grunt.' },
        ]),
        wemInfo(0x00012345, [{ wemId: 0x00c0ffee, text: 'Overridden.' }]),
      ],
    );
    const voiceDir = path.join(modImportLocalizeDir(extractRoot, 'uk'), 'Sound', 'Voice');
    for (const stem of ['00ae4a02', '00ae4a03']) {
      touch(path.join(voiceDir, 'Mod.esm', 'NPCFAndreja', `${stem}.wem`));
      touch(path.join(voiceDir, 'Mod.esm', 'NPCFAndreja', `${stem}.ffxanim`));
    }
    touch(path.join(voiceDir, 'Starfield.esm', 'NPCMBarrett', '00c0ffee.wem'));
    touch(path.join(voiceDir, 'Starfield.esm', 'NPCMBarrett', '00c0ffee.ffxanim'));
    // Left over from something else: no response of the plugin names it.
    touch(path.join(voiceDir, 'Mod.esm', 'NPCFAndreja', '0badf00d.wem'));
    touch(path.join(voiceDir, 'Mod.esm', 'NPCFAndreja', 'notes.txt'));
    return { pluginPath, voiceDir };
  };

  it('ships the take and the animation beside it', () => {
    const game = registerWemTestGame();
    expect(localizedVoiceExtensions(game)).toEqual(['.wem', '.ffxanim']);
    expect(localizedVoiceExtensions('fo4')).toEqual(['.fuz']);
    expect(localizedVoiceExtensions(undefined)).toEqual(['.fuz']);
  });

  it('collects every take file when no allow-list is given', async () => {
    const game = registerWemTestGame();
    const { pluginPath } = setUp();
    const files = await collectLocalizedVoiceFiles(pluginPath, 'uk', { game });
    expect(files.map((file) => file.name)).toEqual([
      'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a02.ffxanim',
      'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a02.wem',
      'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a03.ffxanim',
      'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a03.wem',
      'Sound/Voice/Mod.esm/NPCFAndreja/0badf00d.wem',
      'Sound/Voice/Starfield.esm/NPCMBarrett/00c0ffee.ffxanim',
      'Sound/Voice/Starfield.esm/NPCMBarrett/00c0ffee.wem',
    ]);
  });

  it('keeps only the pairs whose line is exportable, resolving ids through the plugin', async () => {
    const game = registerWemTestGame();
    const { pluginPath } = setUp();
    const files = await collectLocalizedVoiceFiles(pluginPath, 'uk', {
      game,
      exportableKeys: new Set(['mod.esm/000800:1', 'starfield.esm/012345:1']),
    });
    expect(files.map((file) => file.name)).toEqual([
      'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a02.ffxanim',
      'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a02.wem',
      'Sound/Voice/Starfield.esm/NPCMBarrett/00c0ffee.ffxanim',
      'Sound/Voice/Starfield.esm/NPCMBarrett/00c0ffee.wem',
    ]);
  });

  it('does not take a .wem for a take of a .fuz title', async () => {
    const { pluginPath } = setUp();
    expect(await collectLocalizedVoiceFiles(pluginPath, 'uk', { game: 'fo4' })).toEqual([]);
  });
});
