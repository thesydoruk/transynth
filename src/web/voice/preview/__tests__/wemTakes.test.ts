import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gamePlugin } from '../../../../games/registry';
import { clearModLocalizedVoiceFiles } from '../../../../voice/clearModGeneratedVoice';
import { _resetInfoVoiceResponseCacheForTests } from '../../../../voice/infoResponseNumbers';
import { wemFfxanimTakes } from '../../../../voice/takeFormat';
import { touch, wemInfo, writePlugin } from '../../../../voice/__tests__/wemFixtures';
import { registerWemTestGame } from '../../../../voice/__tests__/wemTestGame';
import {
  commitPreviewTake,
  previewArtifact,
  writePreviewTake,
  type VoiceRegeneratePreviewMeta,
} from '../../voiceRegenerateSession';
import {
  buildTranslationAudioSet,
  findLocalizedVoiceForEntry,
  hasTranslationAudioForEntry,
  voiceEntryAudioKey,
} from '../translationAudioIndex';
import { discoverVoiceEntries } from '../voiceEntries';

describe('the editor and takes named by WEM id', () => {
  let root: string;
  let pluginPath: string;
  let localizeDir: string;
  const takes = wemFfxanimTakes('opus');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-wem-'));
    pluginPath = path.join(root, 'mod', 'Mod.esm');
    localizeDir = path.join(root, 'localize');
    writePlugin(
      pluginPath,
      [],
      [
        wemInfo(0x00000800, [
          { wemId: 0x00ae4a02, text: 'Hello.' },
          { wemId: 0x00ae4a03, text: 'Bye.' },
        ]),
      ],
    );
    const voice = path.join(root, 'mod', 'Sound', 'Voice', 'Mod.esm');
    touch(path.join(voice, 'NPCFAndreja', '00ae4a02.wem'));
    touch(path.join(voice, 'NPCFAndreja', '00ae4a03.wem'));
    touch(path.join(voice, 'NPCMBarrett', '00ae4a02.wem'));
  });

  afterEach(() => {
    _resetInfoVoiceResponseCacheForTests();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const ctx = () => ({
    packageDir: path.join(root, 'mod'),
    pluginRel: 'Mod.esm',
    pluginPath,
    localizeDir,
  });

  it('lists the source takes in the game format', () => {
    expect(discoverVoiceEntries(ctx(), takes)).toHaveLength(3);
    // Read as a .fuz title the same tree holds nothing.
    expect(discoverVoiceEntries(ctx())).toEqual([]);
  });

  it('knows which takes are dubbed, per speaker folder', () => {
    const dubbed = path.join(localizeDir, 'Sound', 'Voice', 'Mod.esm', 'NPCFAndreja');
    touch(path.join(dubbed, '00ae4a02.wem'));
    touch(path.join(dubbed, '00ae4a02.ffxanim'));

    const voice = gamePlugin(registerWemTestGame()).voice!;
    const set = buildTranslationAudioSet(localizeDir, voice, pluginPath);
    const entries = discoverVoiceEntries(ctx(), takes);
    const state = Object.fromEntries(
      entries.map((entry) => [
        `${path.basename(path.dirname(entry.relPath))}/${entry.variant}`,
        hasTranslationAudioForEntry(set, entry),
      ]),
    );
    expect(state).toEqual({
      'NPCFAndreja/1': true,
      'NPCFAndreja/2': false,
      'NPCMBarrett/1': false,
    });
    expect(set.has('mod.esm/000800:1')).toBe(true);

    expect(voiceEntryAudioKey(entries[0]!)).toBe('sound/voice/mod.esm/npcfandreja/00ae4a02');
    expect(findLocalizedVoiceForEntry(localizeDir, entries[0]!)).toBe(
      path.join(dubbed, '00ae4a02.wem'),
    );
    expect(findLocalizedVoiceForEntry(localizeDir, entries[1]!)).toBeNull();

    // Without the plugin the names cannot be read, and nothing is claimed.
    expect(buildTranslationAudioSet(localizeDir, voice).size).toBe(0);
  });

  it('clears a take together with its animation and counts it once', () => {
    const dubbed = path.join(localizeDir, 'Sound', 'Voice', 'Mod.esm');
    touch(path.join(dubbed, 'NPCFAndreja', '00ae4a02.wem'));
    touch(path.join(dubbed, 'NPCFAndreja', '00ae4a02.ffxanim'));
    touch(path.join(dubbed, 'NPCMBarrett', '00ae4a02.wem'));
    touch(path.join(dubbed, 'NPCMBarrett', '00ae4a02.ffxanim'));
    const strings = touch(path.join(localizeDir, 'Strings', 'Mod_uk.STRINGS'));

    expect(clearModLocalizedVoiceFiles(localizeDir, 'NPCFAndreja')).toBe(1);
    expect(fs.readdirSync(path.join(dubbed, 'NPCFAndreja'))).toEqual([]);
    expect(clearModLocalizedVoiceFiles(localizeDir)).toBe(1);
    expect(fs.readdirSync(path.join(dubbed, 'NPCMBarrett'))).toEqual([]);
    expect(fs.existsSync(strings)).toBe(true);
  });

  it('keeps a regenerated take with its animation through review and commit', () => {
    const session = path.join(root, 'session');
    fs.mkdirSync(session);
    const stored = writePreviewTake(session, 'abcdef012345', {
      ok: true,
      destRelPath: 'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a02.wem',
      payloadVersion: 'v',
      artifact: 'wem',
      audio: Buffer.from('wem bytes'),
      sidecars: [{ extension: '.ffxanim', data: Buffer.from('anim bytes') }],
      voiceSimilarity: null,
    });
    expect(path.basename(stored.takePath)).toBe('abcdef012345.wem');
    expect(stored.sidecars).toEqual(['.ffxanim']);

    const preview: VoiceRegeneratePreviewMeta = {
      id: 'abcdef012345',
      attempt: 1,
      createdAt: '',
      fuzRel: 'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a02.wem',
      payloadVersion: 'v',
      params: { line_reference: true },
      artifact: 'wem',
      sidecars: stored.sidecars,
    };
    const dest = path.join(localizeDir, 'Sound', 'Voice', 'Mod.esm', 'NPCFAndreja', '00ae4a02.wem');
    expect(commitPreviewTake(session, preview, dest)).toBe(true);
    expect(fs.readFileSync(dest, 'utf8')).toBe('wem bytes');
    expect(fs.readFileSync(dest.replace(/\.wem$/, '.ffxanim'), 'utf8')).toBe('anim bytes');

    // A session from before takes had kinds holds a .fuz; a missing file is reported.
    expect(previewArtifact({ ...preview, artifact: undefined })).toBe('fuz');
    expect(commitPreviewTake(session, { ...preview, id: '000000000000' }, dest)).toBe(false);
  });
});
