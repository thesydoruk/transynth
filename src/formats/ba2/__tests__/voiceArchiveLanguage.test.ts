import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { foreignVoiceArchives } from '../voiceArchiveLanguage';

const names = (paths: string[]): string[] => paths.map((p) => path.basename(p)).sort();

describe('foreignVoiceArchives', () => {
  it("names the other languages' copies of a voice archive", () => {
    const archives = ['de', 'en', 'es', 'fr', 'ja'].map((lang) => `SFBGS003 - Voices_${lang}.ba2`);
    expect(names(foreignVoiceArchives([...archives, 'SFBGS003 - Main.ba2'], 'en'))).toEqual([
      'SFBGS003 - Voices_de.ba2',
      'SFBGS003 - Voices_es.ba2',
      'SFBGS003 - Voices_fr.ba2',
      'SFBGS003 - Voices_ja.ba2',
    ]);
    expect(names(foreignVoiceArchives(archives, 'JA'))).toHaveLength(4);
  });

  it('leaves a set alone when the source language is not in it', () => {
    expect(foreignVoiceArchives(['Dub - Voices_de.ba2', 'Dub - Voices_fr.ba2'], 'en')).toEqual([]);
    expect(
      foreignVoiceArchives(['Starfield - Voices01.ba2', 'Starfield - Voices02.ba2'], 'en'),
    ).toEqual([]);
  });

  it('compares only archives of one plugin, one part and one folder', () => {
    const archives = [
      'A - Voices_en.ba2',
      'B - Voices_ja.ba2',
      'Skyrim - Voices_en0.bsa',
      'Skyrim - Voices_fr0.bsa',
      'Skyrim - Voices_fr1.bsa',
      path.join('other', 'A - Voices_de.ba2'),
    ];
    expect(names(foreignVoiceArchives(archives, 'en'))).toEqual(['Skyrim - Voices_fr0.bsa']);
  });

  it('does not take a suffix that is no language for one', () => {
    expect(
      foreignVoiceArchives(
        ['Dub - Voices_en.ba2', 'Dub - Voices_patch.ba2', 'Dub - Voices.ba2'],
        'en',
      ),
    ).toEqual([]);
  });
});
