import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { creationEngineVoiceAdapter } from '../../../../games/creation-engine/voice';
import { discoVoiceAdapter } from '../../../../games/disco-elysium/voice';
import { discoVoiceFormidLower6 } from '../../../../games/disco-elysium/voice/discoverDiscoVoiceFiles';
import {
  buildTranslationAudioSet,
  hasTranslationAudio,
  hasTranslationAudioForEntry,
  voiceEntryAudioKey,
} from '../translationAudioIndex';

const writeVoice = (root: string, rel: string): string => {
  const abs = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x');
  return abs;
};

describe('buildTranslationAudioSet', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-localize-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('indexes a take under Data/ even when that prefix is not in the join path', () => {
    writeVoice(
      root,
      'Data/Sound/Voice/AA FusionCityRising.esp/ClubFusionDanaFeytonVoice/00002185_1.fuz',
    );
    const set = buildTranslationAudioSet(root, creationEngineVoiceAdapter);
    expect(hasTranslationAudio(set, '002185', 1)).toBe(true);
    expect(hasTranslationAudio(set, '002185', 2)).toBe(false);
  });

  it('ignores files that are not voice takes', () => {
    writeVoice(root, 'Sound/Voice/Mod.esp/NPC/readme.txt');
    expect(buildTranslationAudioSet(root, creationEngineVoiceAdapter).size).toBe(0);
  });

  it('treats Nate and Nora dubs of the same FormID as separate clips', () => {
    writeVoice(root, 'Sound/Voice/Fallout4.esm/PlayerVoiceMale01/00005825_1.fuz');
    writeVoice(root, 'Sound/Voice/Fallout4.esm/PlayerVoiceFemale01/00005825_1.fuz');
    const set = buildTranslationAudioSet(root, creationEngineVoiceAdapter);
    const nate = { relPath: 'Sound/Voice/Fallout4.esm/PlayerVoiceMale01/00005825_1.fuz' };
    const nora = { relPath: 'Sound/Voice/Fallout4.esm/PlayerVoiceFemale01/00005825_1.fuz' };

    expect(voiceEntryAudioKey(nate)).not.toBe(voiceEntryAudioKey(nora));
    expect(hasTranslationAudioForEntry(set, nate)).toBe(true);
    expect(hasTranslationAudioForEntry(set, nora)).toBe(true);
  });

  it('indexes Disco stem wavs by the FormID hashed from the stem', () => {
    writeVoice(root, 'Audio/Kim Kitsuragi-YARD-1.wav');
    const formid = discoVoiceFormidLower6('Kim Kitsuragi-YARD-1');
    const set = buildTranslationAudioSet(root, discoVoiceAdapter);
    expect(hasTranslationAudio(set, formid, 1)).toBe(true);
  });
});
