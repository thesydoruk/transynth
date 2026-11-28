import { afterEach, describe, expect, it } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import type { Tx } from '../../db';
import '../../games';
import { referenceVoiceTakePath } from '../../modStorage';
import { pruneSkippedReferenceVoiceTakes } from '../pruneReferenceVoiceTakes';

// A language no real store has, so the test owns every file it touches.
const LANG = `zz${process.pid}`;
const VERSION = 'a'.repeat(40);

const row = (sha: string, sourceText: string, translation: string, game = 'fo4') => ({
  game,
  source_sha1: sha.repeat(40),
  tts_text_version: VERSION,
  file_ext: '.fuz',
  file_size: 1000,
  source_text: sourceText,
  translation,
});

const pathOf = (stored: ReturnType<typeof row>): string =>
  referenceVoiceTakePath({
    game: stored.game,
    lang: LANG,
    sourceSha1: stored.source_sha1,
    ttsTextVersion: stored.tts_text_version,
    fileExt: stored.file_ext,
  });

const BARK = row('1', 'Nuh.', 'Не-а.');
const GRUNT = row('2', 'Hurgh!', 'Хр-рх!', 'sf1');
const SPEECH = row('3', 'Hello there.', 'Привіт.');
const ROWS = [BARK, GRUNT, SPEECH];

const fakeDb = (deletes: unknown[][]): Tx =>
  ({
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('DELETE')) {
        deletes.push(params);
        return { rows: [], rowCount: 1 };
      }
      return { rows: ROWS };
    },
  }) as unknown as Tx;

describe('pruneSkippedReferenceVoiceTakes', () => {
  const written: string[] = [];
  const store = (): void => {
    for (const stored of ROWS) {
      const file = pathOf(stored);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'x');
      written.push(file);
    }
  };

  afterEach(() => {
    for (const file of written.splice(0)) {
      // .../_reference_voice/{game}/{lang}/{xx}/{file}: drop the language folder.
      fs.rmSync(path.dirname(path.dirname(file)), { recursive: true, force: true });
    }
  });

  it('only counts on a dry run', async () => {
    store();
    const deletes: unknown[][] = [];
    const result = await pruneSkippedReferenceVoiceTakes(fakeDb(deletes), LANG);

    expect(result).toMatchObject({
      judged: 3,
      rows: 2,
      bytes: 2000,
      byGame: { fo4: 1, sf1: 1 },
      byReason: { phonetic_vocalization: 2 },
      rowsRemoved: 0,
      filesRemoved: 0,
    });
    expect(result.samples).toEqual(['fo4 "Nuh." → "Не-а."', 'sf1 "Hurgh!" → "Хр-рх!"']);
    expect(deletes).toEqual([]);
    for (const stored of ROWS) expect(fs.existsSync(pathOf(stored))).toBe(true);
  });

  it('removes the rows and files of skipped lines and keeps speech', async () => {
    store();
    const deletes: unknown[][] = [];
    const result = await pruneSkippedReferenceVoiceTakes(fakeDb(deletes), LANG, { apply: true });

    expect(result).toMatchObject({ rows: 2, rowsRemoved: 2, filesRemoved: 2 });
    expect(fs.existsSync(pathOf(BARK))).toBe(false);
    expect(fs.existsSync(pathOf(GRUNT))).toBe(false);
    expect(fs.existsSync(pathOf(SPEECH))).toBe(true);
    expect(deletes).toEqual([
      ['fo4', LANG, BARK.source_sha1, VERSION],
      ['sf1', LANG, GRUNT.source_sha1, VERSION],
    ]);
  });

  it('deletes the row of a take whose file is already gone', async () => {
    const deletes: unknown[][] = [];
    const result = await pruneSkippedReferenceVoiceTakes(fakeDb(deletes), LANG, { apply: true });
    expect(result).toMatchObject({ rowsRemoved: 2, filesRemoved: 0 });
  });
});
