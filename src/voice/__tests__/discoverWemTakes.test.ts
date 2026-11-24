import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverWemTakes } from '../discoverWemTakes';
import { _resetInfoVoiceResponseCacheForTests } from '../infoResponseNumbers';
import { FUZ_TAKES, voiceTakeFormat, wemFfxanimTakes } from '../takeFormat';
import { touch, wemInfo, writePlugin } from './wemFixtures';

describe('takes named by WEM id', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-wem-'));
  });

  afterEach(() => {
    _resetInfoVoiceResponseCacheForTests();
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** A patch with one own line and one override of its master, and a voice tree around them. */
  const makePatch = (voiceTree = path.join('Sound', 'Voice')): string => {
    writePlugin(
      path.join(root, 'Patch.esm'),
      ['Starfield.esm'],
      [
        wemInfo(0x00012345, [{ wemId: 0x00ae4a02, text: 'Fixed.' }]),
        wemInfo(0x01000800, [
          { wemId: 0x00000b01, text: 'One.' },
          { wemId: 0x00000b02, text: 'Two.' },
        ]),
      ],
    );
    const voice = path.join(root, voiceTree);
    touch(path.join(voice, 'Patch.esm', 'NPCFAndreja', '00000b01.wem'));
    touch(path.join(voice, 'Patch.esm', 'NPCFAndreja', '00000b01.ffxanim'));
    touch(path.join(voice, 'Patch.esm', 'NPCFAndreja', '00000B02.wem'));
    touch(path.join(voice, 'Patch.esm', 'NPCMBarrett', '00000b01.wem'));
    // A fixed take of the master's line sits under the master's folder.
    touch(path.join(voice, 'starfield.esm', 'NPCFAndreja', '00ae4a02.wem'));
    // Nothing in the plugin names these.
    touch(path.join(voice, 'Patch.esm', 'NPCFAndreja', '0badf00d.wem'));
    touch(path.join(voice, 'Patch.esm', 'NPCFAndreja', '00000b01_1.fuz'));
    // Not this plugin's and not a master's.
    touch(path.join(voice, 'Other.esm', 'NPCFAndreja', '00000b01.wem'));
    return path.join(root, 'Patch.esm');
  };

  it('gives each file the identity of the response that names it', () => {
    makePatch();
    const takes = discoverWemTakes(root, 'Patch.esm');

    expect(takes.map((take) => take.relPath)).toEqual([
      'Sound/Voice/Patch.esm/NPCFAndreja/00000b01.wem',
      'Sound/Voice/Patch.esm/NPCFAndreja/00000B02.wem',
      'Sound/Voice/Patch.esm/NPCMBarrett/00000b01.wem',
      'Sound/Voice/starfield.esm/NPCFAndreja/00ae4a02.wem',
    ]);
    expect(takes.map((take) => [take.originPlugin, take.lineKey, take.variant, take.ext])).toEqual([
      ['patch.esm', '000800', 1, 'wem'],
      ['patch.esm', '000800', 2, 'wem'],
      ['patch.esm', '000800', 1, 'wem'],
      ['starfield.esm', '012345', 1, 'wem'],
    ]);
    expect(fs.existsSync(takes[0]!.absolutePath)).toBe(true);
  });

  it('finds a tree spelled in lower case and still names the canonical one', () => {
    makePatch(path.join('sound', 'voice'));
    const takes = discoverWemTakes(root, 'Patch.esm');
    expect(takes).toHaveLength(4);
    expect(takes.every((take) => take.relPath.startsWith('Sound/Voice/'))).toBe(true);
  });

  it('finds nothing when the plugin names no WEM file', () => {
    writePlugin(path.join(root, 'Empty.esm'), []);
    touch(path.join(root, 'Sound', 'Voice', 'Empty.esm', 'Npc', '00000b01.wem'));
    expect(discoverWemTakes(root, 'Empty.esm')).toEqual([]);
  });

  describe('as a take format', () => {
    const takes = wemFfxanimTakes('opus');

    it('is what a title asking for .wem takes gets, and .fuz is the default', () => {
      expect(voiceTakeFormat({ kind: 'wem-ffxanim', codec: 'opus' })).toBe(takes);
      expect(voiceTakeFormat(undefined)).toBe(FUZ_TAKES);
      expect(voiceTakeFormat({ kind: 'fuz' })).toBe(FUZ_TAKES);
      expect([takes.extension, takes.sidecarExtensions, takes.needsSpeakerSex]).toEqual([
        '.wem',
        ['.ffxanim'],
        true,
      ]);
      expect([FUZ_TAKES.extension, FUZ_TAKES.sidecarExtensions, FUZ_TAKES.needsSpeakerSex]).toEqual(
        ['.fuz', [], false],
      );
    });

    it('writes the dub at the mirrored path under the same id', () => {
      makePatch();
      const [take] = takes.discover(root, 'Patch.esm');
      expect(takes.localizedRelPath(take!)).toBe('Sound/Voice/Patch.esm/NPCFAndreja/00000b01.wem');
    });

    it('reads a key off a path only against the plugin', () => {
      const pluginPath = makePatch();
      const keyOf = takes.voiceKeyResolver(pluginPath);
      expect(keyOf('Sound/Voice/Patch.esm/NPCFAndreja/00000b02.wem')).toBe('patch.esm/000800:2');
      // The animation belongs to the same line and is exported with it.
      expect(keyOf('Sound\\Voice\\Patch.esm\\NPCFAndreja\\00000B02.ffxanim')).toBe(
        'patch.esm/000800:2',
      );
      expect(keyOf('Sound/Voice/Starfield.esm/NPCFAndreja/00ae4a02.wem')).toBe(
        'starfield.esm/012345:1',
      );
      expect(keyOf('Sound/Voice/Patch.esm/NPCFAndreja/0badf00d.wem')).toBeNull();
      expect(keyOf('Sound/Voice/Patch.esm/NPCFAndreja/00000b01_1.fuz')).toBeNull();

      const blind = takes.voiceKeyResolver();
      expect(blind('Sound/Voice/Patch.esm/NPCFAndreja/00000b02.wem')).toBeNull();
    });

    it('names a borrowed take the way the borrowing plugin does', () => {
      const pluginPath = makePatch();
      const masterTake = {
        relPath: 'Sound/Voice/Starfield.esm/NPCFAndreja/00ffff01.wem',
        absolutePath: '/master/00ffff01.wem',
        fileName: '00ffff01.wem',
        lineKey: '012345',
        variant: 1,
        ext: 'wem' as const,
        originPlugin: 'starfield.esm',
      };
      expect(takes.ownTakeFileName?.(pluginPath, masterTake)).toBe('00ae4a02.wem');
      expect(takes.ownTakeFileName?.(pluginPath, { ...masterTake, variant: 9 })).toBeNull();
      expect(FUZ_TAKES.ownTakeFileName).toBeUndefined();
    });
  });

  it('keeps the .fuz rules where they were', () => {
    const keyOf = FUZ_TAKES.voiceKeyResolver();
    expect(keyOf('Sound/Voice/Fallout4.esm/MaleRough/00123456_1.fuz')).toBe(
      'fallout4.esm/123456:1',
    );
    expect(keyOf('Sound/Voice/Fallout4.esm/MaleRough/00123456.wem')).toBeNull();
    expect(
      FUZ_TAKES.localizedRelPath({
        relPath: 'Sound/Voice/Fallout4.esm/MaleRough/00123456_1.xwm',
        absolutePath: '/x',
        fileName: '00123456_1.xwm',
        lineKey: '123456',
        variant: 1,
        ext: 'xwm',
      }),
    ).toBe('Sound/Voice/Fallout4.esm/MaleRough/00123456_1.fuz');
  });
});
