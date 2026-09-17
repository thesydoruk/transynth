import { describe, expect, it, afterEach } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alignDiscoTakesByAsr } from '../voice/alignTakesByAsr';
import { invalidateDiscoSpokenPoLines } from '../voice/spokenPoLines';
import { invalidateDiscoVoiceTextIndex } from '../voice/voiceTextIndex';

/** Three takes, four lockit rows: the middle row is never voiced. */
const UNEVEN_PO = `msgid ""
msgstr ""
"Content-Type: text/plain; charset=UTF-8\\n"

#  Title = YARD / HANGED MAN
#  Actor = Kim Kitsuragi
msgctxt "Dialogue Text/0x0100000000000001"
msgid "Morning, detective. Ready to look at the body?"
msgstr ""

#  Title = YARD / HANGED MAN
#  Actor = Kim Kitsuragi
msgctxt "Dialogue Text/0x0100000000000002"
msgid "[Thought cabinet slot unlocked.]"
msgstr ""

#  Title = YARD / HANGED MAN
#  Actor = Kim Kitsuragi
msgctxt "Dialogue Text/0x0100000000000003"
msgid "The body is still hanging there, waiting for us."
msgstr ""

#  Title = YARD / HANGED MAN
#  Actor = Kim Kitsuragi
msgctxt "Dialogue Text/0x0100000000000004"
msgid "Let us not keep the corpse waiting any longer."
msgstr ""
`;

const TAKES: Record<string, string> = {
  'Kim Kitsuragi-YARD  HANGED MAN-10': 'Morning, detective. Ready to look at the body?',
  'Kim Kitsuragi-YARD  HANGED MAN-20': 'The body is still hanging there, waiting for us.',
  'Kim Kitsuragi-YARD  HANGED MAN-30': 'Let us not keep the corpse waiting any longer.',
};

const writePack = (files: { rel: string; contents?: string }[]): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-align-'));
  for (const file of files) {
    const abs = path.join(root, file.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, file.contents ?? 'x');
  }
  return root;
};

const transcribeFromStem = async (wavPath: string): Promise<string> =>
  TAKES[path.basename(wavPath, path.extname(wavPath))] ?? '';

describe('alignDiscoTakesByAsr', () => {
  let root = '';

  afterEach(() => {
    if (root) {
      invalidateDiscoVoiceTextIndex(root);
      invalidateDiscoSpokenPoLines();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  const unevenPack = () =>
    writePack([
      { rel: 'English_English_en/DialoguesLockitEnglish.po', contents: UNEVEN_PO },
      ...Object.keys(TAKES).map((stem) => ({ rel: `English_English_en/Audio/${stem}.wav` })),
    ]);

  it('matches takes to the rows they say, skipping the unvoiced one', async () => {
    root = unevenPack();
    const result = await alignDiscoTakesByAsr(root, { transcribe: transcribeFromStem });

    expect(result.groups).toBe(1);
    expect(result.transcribed).toBe(3);
    expect(result.refs.get('Kim Kitsuragi-YARD  HANGED MAN-10')).toMatchObject({
      field: 'Dialogue Text',
      articyId: '0x0100000000000001',
    });
    expect(result.refs.get('Kim Kitsuragi-YARD  HANGED MAN-20')).toMatchObject({
      articyId: '0x0100000000000003',
    });
    expect(result.refs.get('Kim Kitsuragi-YARD  HANGED MAN-30')).toMatchObject({
      articyId: '0x0100000000000004',
    });
  });

  it('carries the match score so a weak pairing stays visible', async () => {
    root = unevenPack();
    const result = await alignDiscoTakesByAsr(root, { transcribe: transcribeFromStem });
    for (const ref of result.refs.values()) expect(ref.score).toBeGreaterThan(0.9);
  });

  it('leaves takes unmatched when nothing can be transcribed', async () => {
    root = unevenPack();
    const result = await alignDiscoTakesByAsr(root, { transcribe: async () => '' });
    expect(result.refs.size).toBe(0);
    expect(result.takes).toBe(3);
  });

  it('survives a transcriber that throws', async () => {
    root = unevenPack();
    const result = await alignDiscoTakesByAsr(root, {
      transcribe: async () => {
        throw new Error('audio-intel down');
      },
    });
    expect(result.refs.size).toBe(0);
    expect(result.transcribeFailures).toBe(3);
  });

  it('has nothing to do when counts already agree', async () => {
    root = writePack([
      { rel: 'English_English_en/DialoguesLockitEnglish.po', contents: UNEVEN_PO },
      ...['10', '20', '30', '40'].map((id) => ({
        rel: `English_English_en/Audio/Kim Kitsuragi-YARD  HANGED MAN-${id}.wav`,
      })),
    ]);
    const result = await alignDiscoTakesByAsr(root, { transcribe: transcribeFromStem });
    expect(result.groups).toBe(0);
    expect(result.transcribed).toBe(0);
  });
});
