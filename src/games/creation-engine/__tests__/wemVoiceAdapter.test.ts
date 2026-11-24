import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gamePlugin } from '../../registry';
import { _resetInfoVoiceResponseCacheForTests } from '../../../voice/infoResponseNumbers';
import { FUZ_TAKES, voiceTakesForGame, wemFfxanimTakes } from '../../../voice/takeFormat';
import { touch, wemInfo, writePlugin } from '../../../voice/__tests__/wemFixtures';
import { registerWemTestGame } from '../../../voice/__tests__/wemTestGame';
import { createCreationEngineVoiceAdapter, creationEngineVoiceAdapter } from '../voice';

describe('Creation Engine voice adapter and the title take format', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ce-wem-adapter-'));
  });

  afterEach(() => {
    _resetInfoVoiceResponseCacheForTests();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('keeps .fuz for every title that declares nothing', () => {
    for (const game of ['fo4', 'fo76', 'sse', 'fnv']) {
      const voice = gamePlugin(game).voice;
      expect(voice?.takes).toBe(FUZ_TAKES);
      expect(voice?.sourceExtension).toBe('.fuz');
      expect(voiceTakesForGame(game)).toBe(FUZ_TAKES);
    }
    expect(creationEngineVoiceAdapter.takes).toBe(FUZ_TAKES);
    expect(
      creationEngineVoiceAdapter.voiceKeyFromRelPath(
        'Sound/Voice/Fallout4.esm/MaleRough/00123456_1.fuz',
      ),
    ).toBe('fallout4.esm/123456:1');
    // A game without a voice tree has no take format and gets the default where one is asked for.
    expect(gamePlugin('disco').voice?.takes).toBeUndefined();
  });

  it('builds the adapter of a title around the format it declares', () => {
    const voice = gamePlugin(registerWemTestGame()).voice!;
    expect(voice.takes).toBe(wemFfxanimTakes('opus'));
    expect(voice.sourceExtension).toBe('.wem');
    expect(voice.takes?.sidecarExtensions).toEqual(['.ffxanim']);
    expect(voice.isLocalizedVoicePath('sound/voice/mod.esm/npc/00ae4a02.wem')).toBe(true);
    // The file name alone does not say which line it is.
    expect(voice.voiceKeyFromRelPath('Sound/Voice/Mod.esm/Npc/00ae4a02.wem')).toBeNull();
  });

  it('discovers source takes and places their dubs through the format', () => {
    const pluginPath = path.join(root, 'Mod.esm');
    writePlugin(pluginPath, [], [wemInfo(0x00000800, [{ wemId: 0x00ae4a02, text: 'Hello.' }])]);
    touch(path.join(root, 'Sound', 'Voice', 'Mod.esm', 'NPCFAndreja', '00ae4a02.wem'));
    touch(path.join(root, 'Sound', 'Voice', 'Mod.esm', 'NPCFAndreja', '00000800_1.fuz'));

    const wem = createCreationEngineVoiceAdapter(wemFfxanimTakes('opus'));
    const takes = wem.discoverSourceTakes({ extractDir: root, pluginPath });
    expect(takes.map((take) => [take.fileName, take.lineKey, take.variant])).toEqual([
      ['00ae4a02.wem', '000800', 1],
    ]);
    expect(wem.localizedTakeRelPath(takes[0]!)).toBe(
      'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a02.wem',
    );

    // The same folder read as a .fuz title: the other file, the same line.
    const fuz = creationEngineVoiceAdapter.discoverSourceTakes({ extractDir: root, pluginPath });
    expect(fuz.map((take) => [take.fileName, take.lineKey, take.variant])).toEqual([
      ['00000800_1.fuz', '000800', 1],
    ]);
  });
});
