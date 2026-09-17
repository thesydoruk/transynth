import { describe, expect, it, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverDiscoVoiceFiles } from '../voice/discoverDiscoVoiceFiles';
import { invalidateDiscoSpokenPoLines } from '../voice/spokenPoLines';

/** One voiced line of one conversation — enough to know the conversation. */
const DIALOGUE_PO = `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

#  Title = YARD / HANGED MAN
#  Actor = Kim Kitsuragi
msgctxt "Dialogue Text/0x0100000000000001"
msgid "Morning, detective. Ready to look at the body?"
msgstr ""
`;

const writePack = (files: { rel: string; contents?: string }[]): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-takes-'));
  for (const file of files) {
    const abs = path.join(root, file.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.contents ?? 'x');
  }
  return root;
};

describe('discoverDiscoVoiceFiles', () => {
  let root = '';

  afterEach(() => {
    if (root) {
      invalidateDiscoSpokenPoLines();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves soundtrack, ambience and foley out of the voice list', () => {
    root = writePack([
      { rel: 'English_English_en/DialoguesLockitEnglish.po', contents: DIALOGUE_PO },
      { rel: 'English_English_en/Audio/Kim Kitsuragi-YARD  HANGED MAN-10.wav' },
      { rel: 'English_English_en/Audio/city-birds-01.wav' },
      { rel: 'English_English_en/Audio/door-open-01.wav' },
      { rel: 'English_English_en/Audio/01 Instrument of Surrender.wav' },
      { rel: 'English_English_en/Audio/NewspaperEndgame_SUICIDE_THOUGHT_title.wav' },
    ]);
    expect(discoverDiscoVoiceFiles(root).map((entry) => entry.fileName)).toEqual([
      'Kim Kitsuragi-YARD  HANGED MAN-10.wav',
    ]);
  });

  it('keeps every wav when the pack has no conversations to check against', () => {
    root = writePack([
      { rel: 'English_English_en/GeneralLockitEnglish.po', contents: 'msgid ""\nmsgstr ""\n' },
      { rel: 'English_English_en/Audio/city-birds-01.wav' },
    ]);
    expect(discoverDiscoVoiceFiles(root)).toHaveLength(1);
  });
});
