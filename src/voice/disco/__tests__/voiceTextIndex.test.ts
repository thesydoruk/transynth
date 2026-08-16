import { describe, expect, it, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoSpeakerKeyFromStem, parseDiscoWavStem } from '../voiceStem';
import { buildDiscoVoiceTextIndex } from '../voiceTextIndex';

const DIALOGUE_PO = `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

#  Title = YARD / HANGED MAN
#  Actor = Kim Kitsuragi
msgctxt "Dialogue Text/0x0100000000000001"
msgid "First line."
msgstr "First line."

#  Title = YARD / HANGED MAN
#  Actor = Kim Kitsuragi
msgctxt "Dialogue Text/0x0100000000000002"
msgid "Second line."
msgstr "Second line."

#  Title = YARD / HANGED MAN
#  Actor = Kim Kitsuragi
msgctxt "Alternate1/0x0100000000000001"
msgid "First line, take two."
msgstr "First line, take two."
`;

const writePack = (files: { rel: string; contents?: string }[]): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-voice-index-'));
  for (const file of files) {
    const abs = path.join(root, file.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.contents ?? 'x');
  }
  return root;
};

describe('parseDiscoWavStem', () => {
  it('splits actor, conversation, and entry id', () => {
    const parsed = parseDiscoWavStem('Kim Kitsuragi-YARD  HANGED MAN-324');
    expect(parsed).toMatchObject({
      actor: 'Kim Kitsuragi',
      conversation: 'YARD  HANGED MAN',
      entryId: 324,
      alternativeIndex: null,
      mainStem: 'Kim Kitsuragi-YARD  HANGED MAN-324',
    });
  });

  it('keeps hyphenated actor names when the conversation is known', () => {
    const parsed = parseDiscoWavStem('Mega Rich Light-Bending Guy-CONTAINERYARD  GUY-12', [
      'CONTAINERYARD  GUY',
    ]);
    expect(parsed?.actor).toBe('Mega Rich Light-Bending Guy');
    expect(parsed?.conversation).toBe('CONTAINERYARD  GUY');
    expect(parsed?.entryId).toBe(12);
  });

  it('strips alternative- prefixes for speaker keys', () => {
    expect(discoSpeakerKeyFromStem('alternative-0-Empathy-KINEEMA  SYLVIE-198-0')).toBe('Empathy');
  });
});

describe('buildDiscoVoiceTextIndex', () => {
  let root = '';

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('pairs equal-count Dialogue Text rows with wavs and Alternate takes', () => {
    root = writePack([
      { rel: 'English_English_en/DialoguesLockitEnglish.po', contents: DIALOGUE_PO },
      { rel: 'English_English_en/Audio/Kim Kitsuragi-YARD  HANGED MAN-20.wav' },
      { rel: 'English_English_en/Audio/Kim Kitsuragi-YARD  HANGED MAN-10.wav' },
      { rel: 'English_English_en/Audio/alternative-0-Kim Kitsuragi-YARD  HANGED MAN-10-0.wav' },
    ]);

    const index = buildDiscoVoiceTextIndex(root);
    expect(index.get('Kim Kitsuragi-YARD  HANGED MAN-10')).toMatchObject({
      field: 'Dialogue Text',
      articyId: '0x0100000000000001',
    });
    expect(index.get('Kim Kitsuragi-YARD  HANGED MAN-20')).toMatchObject({
      field: 'Dialogue Text',
      articyId: '0x0100000000000002',
    });
    expect(index.get('alternative-0-Kim Kitsuragi-YARD  HANGED MAN-10-0')).toMatchObject({
      field: 'Alternate1',
      articyId: '0x0100000000000001',
    });
  });

  it('does not guess when Dialogue Text count and main wav count differ', () => {
    root = writePack([
      { rel: 'English_English_en/DialoguesLockitEnglish.po', contents: DIALOGUE_PO },
      { rel: 'English_English_en/Audio/Kim Kitsuragi-YARD  HANGED MAN-10.wav' },
    ]);
    const index = buildDiscoVoiceTextIndex(root);
    expect(index.size).toBe(0);
  });

  it('prefers VoiceOverClipsLibrary.json when present', () => {
    root = writePack([
      { rel: 'English_English_en/DialoguesLockitEnglish.po', contents: DIALOGUE_PO },
      { rel: 'English_English_en/Audio/Empathy-KINEEMA  SYLVIE-198.wav' },
      {
        rel: 'VoiceOverClipsLibrary.json',
        contents: JSON.stringify({
          clipInformation: [
            {
              AssetName: 'Empathy-KINEEMA  SYLVIE-198',
              ArticyID: '0x0100002B00060B58',
              alternativeVoiceClips: [
                {
                  AlternativeID: 0,
                  AlternativeAssetName: 'alternative-0-Empathy-KINEEMA  SYLVIE-198-0',
                },
              ],
            },
          ],
        }),
      },
    ]);
    const index = buildDiscoVoiceTextIndex(root);
    expect(index.get('Empathy-KINEEMA  SYLVIE-198')).toMatchObject({
      field: 'Dialogue Text',
      articyId: '0x0100002b00060b58',
    });
    expect(index.get('alternative-0-Empathy-KINEEMA  SYLVIE-198-0')?.field).toBe('Alternate1');
  });
});
