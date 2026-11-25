/**
 * Voice archives that hold one set of takes in several languages.
 *
 * A game dubbed into several languages ships `<Plugin> - Voices_en.ba2`,
 * `- Voices_de.ba2`, `- Voices_ja.ba2` …: the same file paths inside, one
 * archive per language. Unpacked into one tree they overwrite each other, and
 * the archive that happens to come last decides the language of every take.
 */
import path from 'node:path';

/**
 * `<name> - Voices<part>_<language><n>.<ext>`: `SFBGS003 - Voices_ja.ba2`,
 * `Skyrim - Voices_en0.bsa`. A suffix that is not a language (`_patch`) does
 * not match.
 */
const LANGUAGE_VOICE_ARCHIVE_RE =
  /^(.+ - voices?[^_]*)_([a-z]{2}|ptbr|esmx|zhhans|zhhant)(\d*)\.(ba2|bsa)$/;

type LanguageVoiceArchive = { set: string; language: string };

const parseLanguageVoiceArchive = (archivePath: string): LanguageVoiceArchive | null => {
  const match = path.basename(archivePath).toLowerCase().match(LANGUAGE_VOICE_ARCHIVE_RE);
  if (!match) return null;
  const dir = path.dirname(archivePath).toLowerCase();
  return { set: `${dir}|${match[1]}|${match[3]}|${match[4]}`, language: match[2]! };
};

/**
 * The archives of `archivePaths` to leave out: another language's copy of a
 * voice archive the list also holds in the source language. A set with no
 * source-language archive is left whole — one of its languages is all there is.
 */
export const foreignVoiceArchives = (
  archivePaths: readonly string[],
  srcLang: string,
): string[] => {
  const source = srcLang.toLowerCase().replace(/[^a-z]/g, '');
  const parsed = archivePaths.map((archivePath) => ({
    archivePath,
    archive: parseLanguageVoiceArchive(archivePath),
  }));
  const setsWithSource = new Set(
    parsed.filter(({ archive }) => archive?.language === source).map(({ archive }) => archive!.set),
  );
  return parsed
    .filter(
      ({ archive }) =>
        archive != null && archive.language !== source && setsWithSource.has(archive.set),
    )
    .map(({ archivePath }) => archivePath);
};
