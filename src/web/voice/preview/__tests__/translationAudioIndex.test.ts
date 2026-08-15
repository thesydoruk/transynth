import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoVoiceFormidLower6 } from '../../../../voice/disco/discoverDiscoVoiceFiles';
import { buildTranslationAudioSet, findLocalizedVoiceAbsPath } from '../translationAudioIndex';

const writeVoice = (root: string, rel: string): string => {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x');
  return abs;
};

describe('findLocalizedVoiceAbsPath', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-localize-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('finds a fuz under Data/ even when that prefix is not in the join path', () => {
    const abs = writeVoice(
      root,
      'Data/Sound/Voice/AA FusionCityRising.esp/ClubFusionDanaFeytonVoice/00002185_1.fuz',
    );
    expect(findLocalizedVoiceAbsPath(root, '002185', 1)).toBe(abs);
    expect(buildTranslationAudioSet(root).has('002185:1')).toBe(true);
  });

  it('returns null when the line was never localized', () => {
    writeVoice(root, 'Data/Sound/Voice/Mod.esp/NPC/00002185_1.fuz');
    expect(findLocalizedVoiceAbsPath(root, '002185', 2)).toBeNull();
    expect(findLocalizedVoiceAbsPath(root, '00ABCD', 1)).toBeNull();
  });

  it('indexes Disco stem wavs by SHA1 FormID when disco option is set', () => {
    writeVoice(root, 'Audio/Kim Kitsuragi-YARD-1.wav');
    const formid = discoVoiceFormidLower6('Kim Kitsuragi-YARD-1');
    expect(buildTranslationAudioSet(root, { disco: true }).has(`${formid}:1`)).toBe(true);
    expect(findLocalizedVoiceAbsPath(root, formid, 1, { disco: true })).toContain(
      'Kim Kitsuragi-YARD-1.wav',
    );
  });
});
