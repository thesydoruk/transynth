import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals';
import { referenceGameKey } from '../../games/referenceKey';
import { referenceVoiceTakePath } from '../../modStorage';
import { PATHS } from '../../paths';
import { insertMod, useTestDb } from '../../testing/testDb';
import { sha1Hex } from '../../utils/hash';
import { saveReferenceVoiceTakeForLine } from '../referenceVoiceTakeHooks';
import {
  findReferenceVoiceTakes,
  hasReferenceVoiceTakes,
  referenceVoiceTakeMapKey,
  saveReferenceVoiceTake,
} from '../referenceVoiceTakes';
import { reuseReferenceVoiceTakes } from '../reuseReferenceVoiceTakes';
import { ttsVersionForLine, type VoiceReuseSnapshot } from '../voiceReuseSnapshot';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'transynth-reference-voice-'));
const realModUploads = PATHS.modUploads;
PATHS.modUploads = path.join(tmp, 'mod');

const GAME = 'fo4';
const LANG = 'uk';
const SHA1 = sha1Hex('the original take');
const VERSION = 'a'.repeat(64);

let fileCounter = 0;
/** A file with this content somewhere under the temp root. */
const writeTemp = (content: string, name = 'take.fuz'): string => {
  const file = path.join(tmp, 'work', String(++fileCounter), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
};

const storedPath = (ext = '.fuz', sourceSha1 = SHA1, ttsTextVersion = VERSION): string =>
  referenceVoiceTakePath({
    game: referenceGameKey(GAME),
    lang: LANG,
    sourceSha1,
    ttsTextVersion,
    fileExt: ext,
  });

describe('reference voice store', () => {
  const db = useTestDb();

  beforeEach(() => {
    fs.rmSync(PATHS.modUploads, { recursive: true, force: true });
  });

  afterAll(() => {
    PATHS.modUploads = realModUploads;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const save = (content: string, voiceSimilarity: number | null, name = 'take.fuz') =>
    saveReferenceVoiceTake(db(), {
      game: GAME,
      tgtLang: LANG,
      sourceSha1: SHA1,
      ttsTextVersion: VERSION,
      takePath: writeTemp(content, name),
      speakerKey: 'MaleBoston',
      sourceText: 'Hello there.',
      translation: 'Привіт.',
      voiceSimilarity,
      originModName: 'Some Mod',
    });

  const row = async () =>
    (
      await db().query(
        `SELECT game, tgt_lang, speaker_key, source_text, translation, file_ext,
                file_size::int AS file_size, voice_similarity, origin_mod_name
           FROM reference_voice_takes`,
      )
    ).rows;

  it('stores the file under its content address and the row beside it', async () => {
    expect(await hasReferenceVoiceTakes(db(), GAME, LANG)).toBe(false);
    expect(await save('first take', 0.4)).toBe('saved');

    expect(fs.readFileSync(storedPath(), 'utf8')).toBe('first take');
    expect(await row()).toEqual([
      {
        game: referenceGameKey(GAME),
        tgt_lang: LANG,
        speaker_key: 'MaleBoston',
        source_text: 'Hello there.',
        translation: 'Привіт.',
        file_ext: '.fuz',
        file_size: 'first take'.length,
        voice_similarity: 0.4,
        origin_mod_name: 'Some Mod',
      },
    ]);
    expect(await hasReferenceVoiceTakes(db(), GAME, LANG)).toBe(true);
    // No temp file is left next to the take.
    expect(fs.readdirSync(path.dirname(storedPath()))).toHaveLength(1);
  });

  it('replaces a take only with a better-scored one', async () => {
    await save('scored 0.4', 0.4);

    expect(await save('scored 0.3', 0.3)).toBe('kept');
    expect(await save('scored 0.4 again', 0.4)).toBe('kept');
    expect(await save('no score', null)).toBe('kept');
    expect(fs.readFileSync(storedPath(), 'utf8')).toBe('scored 0.4');

    expect(await save('scored 0.5', 0.5)).toBe('saved');
    expect(fs.readFileSync(storedPath(), 'utf8')).toBe('scored 0.5');
    expect((await row())[0]).toMatchObject({ voice_similarity: 0.5, file_size: 10 });
  });

  it('replaces an unscored take with a scored one, never the other way', async () => {
    expect(await save('no score', null)).toBe('saved');
    expect(await save('still no score', null)).toBe('kept');
    expect(await save('scored', 0.1)).toBe('saved');
    expect(fs.readFileSync(storedPath(), 'utf8')).toBe('scored');
  });

  it('refills a row whose file is gone, and drops the file of another extension', async () => {
    await save('scored 0.9', 0.9);
    fs.rmSync(storedPath());
    expect(await save('as wav', null, 'take.wav')).toBe('saved');
    expect(fs.existsSync(storedPath('.wav'))).toBe(true);

    expect(await save('as fuz', 0.2)).toBe('saved');
    expect(fs.existsSync(storedPath('.wav'))).toBe(false);
    expect(await row()).toHaveLength(1);
    expect((await row())[0]).toMatchObject({ file_ext: '.fuz', voice_similarity: 0.2 });
  });

  it('writes nothing on a dry run, and reports what it would do', async () => {
    const input = {
      game: GAME,
      tgtLang: LANG,
      sourceSha1: SHA1,
      ttsTextVersion: VERSION,
      takePath: writeTemp('take'),
      voiceSimilarity: 0.4,
    };
    expect(await saveReferenceVoiceTake(db(), input, { dryRun: true })).toBe('saved');
    expect(await row()).toEqual([]);
    expect(fs.existsSync(storedPath())).toBe(false);
  });

  it('never throws: a take that cannot be read is reported as failed', async () => {
    const outcome = await saveReferenceVoiceTake(db(), {
      game: GAME,
      tgtLang: LANG,
      sourceSha1: SHA1,
      ttsTextVersion: VERSION,
      takePath: path.join(tmp, 'missing.fuz'),
    });
    expect(outcome).toBe('failed');
    expect(
      await saveReferenceVoiceTake(db(), {
        game: GAME,
        tgtLang: LANG,
        sourceSha1: 'not-a-digest',
        ttsTextVersion: VERSION,
        takePath: writeTemp('take'),
      }),
    ).toBe('failed');
    expect(await row()).toEqual([]);
  });

  it('finds takes by (digest, version) pairs and skips rows without a file', async () => {
    const otherSha1 = sha1Hex('another original');
    await save('take', 0.4);
    await saveReferenceVoiceTake(db(), {
      game: GAME,
      tgtLang: LANG,
      sourceSha1: otherSha1,
      ttsTextVersion: VERSION,
      takePath: writeTemp('other'),
    });
    fs.rmSync(storedPath('.fuz', otherSha1));

    const found = await findReferenceVoiceTakes(db(), {
      game: GAME,
      tgtLang: LANG,
      keys: [
        { sourceSha1: SHA1, ttsTextVersion: VERSION },
        { sourceSha1: SHA1, ttsTextVersion: 'b'.repeat(64) },
        { sourceSha1: otherSha1, ttsTextVersion: VERSION },
      ],
    });
    expect([...found.keys()]).toEqual([referenceVoiceTakeMapKey(SHA1, VERSION)]);
    expect(found.get(referenceVoiceTakeMapKey(SHA1, VERSION))).toMatchObject({
      fileExt: '.fuz',
      voiceSimilarity: 0.4,
      absPath: storedPath(),
    });
    expect(
      await findReferenceVoiceTakes(db(), {
        game: GAME,
        tgtLang: 'de',
        keys: [{ sourceSha1: SHA1, ttsTextVersion: VERSION }],
      }),
    ).toEqual(new Map());
  });

  it('keeps a synthesized line by the digest of its source file, past the mod', async () => {
    const modId = await insertMod(db(), { name: 'Voiced Mod', game: GAME });
    const source = writeTemp('the original take', '00011111_1.fuz');
    const outcome = await saveReferenceVoiceTakeForLine(db(), {
      modId,
      tgtLang: LANG,
      speakerKey: 'MaleBoston',
      ttsTextVersion: VERSION,
      voiceSimilarity: 0.6,
      source: { relPath: 'Sound/Voice/Mod.esp/MaleBoston/00011111_1.fuz', absPath: source },
      takePath: writeTemp('synthesized'),
    });
    expect(outcome).toBe('saved');
    expect(fs.readFileSync(storedPath(), 'utf8')).toBe('synthesized');

    await db().query(`DELETE FROM mods WHERE id = $1`, [modId]);
    expect((await row())[0]).toMatchObject({
      origin_mod_name: 'Voiced Mod',
      voice_similarity: 0.6,
    });
  });

  it('reports a line whose source file cannot be hashed', async () => {
    const modId = await insertMod(db(), { game: GAME });
    const outcome = await saveReferenceVoiceTakeForLine(db(), {
      modId,
      tgtLang: LANG,
      ttsTextVersion: VERSION,
      source: { relPath: 'Sound/Voice/Mod.esp/Npc/00022222_1.fuz', absPath: path.join(tmp, 'x') },
      takePath: writeTemp('synthesized'),
    });
    expect(outcome).toBe('no-source-hash');
    expect(await row()).toEqual([]);
  });

  describe('reuse', () => {
    const line = (over: Partial<VoiceReuseSnapshot['lines'][number]> = {}) => ({
      speakerKey: 'MaleBoston',
      originPlugin: 'mod.esp',
      sourceText: 'Hello there.',
      translation: 'Привіт.',
      destRelPath: 'Sound/Voice/Mod.esp/MaleBoston/00011111_1.fuz',
      sourceAbsPath: writeTemp('the original take', '00011111_1.fuz'),
      sourceRelPath: 'Sound/Voice/Mod.esp/MaleBoston/00011111_1.fuz',
      hasLocalized: false,
      lineKey: '011111',
      variant: 1,
      ttsTextVersion: null,
      voiceSimilarity: null,
      ...over,
    });

    const snapshotOf = async (lines: VoiceReuseSnapshot['lines']): Promise<VoiceReuseSnapshot> => ({
      modId: await insertMod(db(), { game: GAME }),
      modName: 'New Version',
      game: GAME,
      localizeDir: path.join(tmp, 'localize', String(++fileCounter)),
      lines,
    });

    const keep = (
      of: VoiceReuseSnapshot['lines'][number],
      content: string,
      name = 'take.fuz',
      sourceContent = 'the original take',
    ) =>
      saveReferenceVoiceTake(db(), {
        game: GAME,
        tgtLang: LANG,
        sourceSha1: sha1Hex(sourceContent),
        ttsTextVersion: ttsVersionForLine(of, LANG),
        takePath: writeTemp(content, name),
        voiceSimilarity: 0.7,
      });

    it('copies a stored take into a line with the same source file and text', async () => {
      const wanted = line();
      const dest = await snapshotOf([wanted]);
      await keep(wanted, 'kept take');

      expect(await reuseReferenceVoiceTakes(db(), dest, LANG)).toBe(1);

      expect(wanted.hasLocalized).toBe(true);
      expect(fs.readFileSync(path.join(dest.localizeDir, wanted.destRelPath), 'utf8')).toBe(
        'kept take',
      );
      const { rows } = await db().query(
        `SELECT line_key, speaker_key, origin_plugin, tts_text_version, voice_similarity
           FROM voice_synthesis_state WHERE mod_id = $1 AND target_lang = $2`,
        [dest.modId, LANG],
      );
      expect(rows).toEqual([
        {
          line_key: '011111',
          speaker_key: 'MaleBoston',
          origin_plugin: 'mod.esp',
          tts_text_version: ttsVersionForLine(wanted, LANG),
          voice_similarity: 0.7,
        },
      ]);
    });

    it('leaves a line whose text, source file or take kind differs', async () => {
      const kept = line();
      const retranslated = line({ translation: 'Вітаю.' });
      const rerecorded = line({
        sourceAbsPath: writeTemp('a new recording', '00033333_1.fuz'),
        sourceRelPath: 'Sound/Voice/Mod.esp/MaleBoston/00033333_1.fuz',
        destRelPath: 'Sound/Voice/Mod.esp/MaleBoston/00033333_1.fuz',
        lineKey: '033333',
      });
      const dest = await snapshotOf([retranslated, rerecorded]);
      await keep(kept, 'kept take');

      expect(await reuseReferenceVoiceTakes(db(), dest, LANG)).toBe(0);

      const wavOnly = line({
        sourceAbsPath: writeTemp('a wav original', '00044444_1.fuz'),
        sourceRelPath: 'Sound/Voice/Mod.esp/MaleBoston/00044444_1.fuz',
        destRelPath: 'Sound/Voice/Mod.esp/MaleBoston/00044444_1.fuz',
        lineKey: '044444',
      });
      const second = await snapshotOf([wavOnly]);
      await keep(wavOnly, 'kept wav', 'take.wav', 'a wav original');

      expect(await reuseReferenceVoiceTakes(db(), second, LANG)).toBe(0);
      expect(wavOnly.hasLocalized).toBe(false);
      expect(fs.existsSync(second.localizeDir)).toBe(false);
    });

    it('does not touch a line that already has its take', async () => {
      const done = line({ hasLocalized: true });
      const dest = await snapshotOf([done]);
      await keep(done, 'kept take');

      expect(await reuseReferenceVoiceTakes(db(), dest, LANG)).toBe(0);
      expect(fs.existsSync(dest.localizeDir)).toBe(false);
    });
  });
});
