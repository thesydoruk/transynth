import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { buildOpusWem, parseOpusWem } from '../audio/opusWem';
import { demuxOggOpus } from '../audio/ogg';
import { buildW3SpeechAudio, readW3SpeechIndex, writeW3Speech } from '../w3speech';
import { writeW3Vlq } from '../w3strings';
import { w3VoiceTextMaps, type W3VoiceLine } from '../voice/lines';
import { WITCHER3_VOICE_MARKUP } from '../voice/markup';
import {
  materializeW3SourceTake,
  readW3SourceTake,
  w3LocalizedTakePaths,
  w3SourceTakeEntry,
  w3VoiceKeyFromFileName,
} from '../voice/takes';
import { witcher3VoiceAdapter } from '../voice';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'w3takes-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const packets = [Buffer.from([0xf8, 0xff, 0xfe]), Buffer.from([0xf8, 1, 2])];

/** `content/content0/enpc.w3speech` holding takes for `ids`. */
const writeContainer = (ids: number[]): void => {
  const dir = path.join(root, 'content', 'content0');
  fs.mkdirSync(dir, { recursive: true });
  const shell = path.join(root, 'shell.w3speech');
  const head = Buffer.alloc(10);
  head.write('CPSW', 0, 'latin1');
  head.writeUInt32LE(164, 4);
  head.writeUInt16LE(0x4397, 8);
  const rows = Buffer.alloc(ids.length * 40 + 2);
  ids.forEach((id, i) => rows.writeUInt32LE((id ^ 0x79321793) >>> 0, i * 40));
  rows.writeUInt16LE(0x5139, ids.length * 40);
  fs.writeFileSync(shell, Buffer.concat([head, writeW3Vlq(ids.length), rows]));
  const fd = fs.openSync(shell, 'r');
  try {
    const take = buildOpusWem({ packets, channels: 1, samples: 1500, preSkip: 312 });
    writeW3Speech(fd, readW3SpeechIndex(fd), path.join(dir, 'enpc.w3speech'), {
      overrides: new Map(
        ids.map((id) => [id, { audio: buildW3SpeechAudio(take, 0.03), lip: Buffer.alloc(0) }]),
      ),
    });
  } finally {
    fs.closeSync(fd);
  }
};

describe('take paths', () => {
  it('puts a localized take beside its container’s name', () => {
    expect(w3LocalizedTakePaths('content/content0/enpc.w3speech', 42)).toEqual({
      wav: 'content/content0/enpc/42.wav',
      audio: 'content/content0/enpc/42.audio',
      lip: 'content/content0/enpc/42.lip',
    });
  });

  it('reads a voice key from a localized take only', () => {
    expect(w3VoiceKeyFromFileName('1185686.wav')).toBe('1185686:1');
    expect(w3VoiceKeyFromFileName('1185686.audio')).toBeNull();
    expect(w3VoiceKeyFromFileName('0001A2B3_1.wav')).toBeNull();
  });

  it('maps a source take to its localized path through the adapter', () => {
    const entry = w3SourceTakeEntry('content/content0/enpc.w3speech#42', '/cache')!;
    expect(witcher3VoiceAdapter.localizedTakeRelPath(entry)).toBe('content/content0/enpc/42.wav');
    expect(entry).toMatchObject({ lineKey: '42', variant: 1, ext: 'ogg' });
  });
});

describe('source takes', () => {
  it('reads a take out of its container and unpacks it to Ogg once', () => {
    writeContainer([7, 9]);
    const clip = 'content/content0/enpc.w3speech#9';
    const take = readW3SourceTake(root, clip)!;
    expect(parseOpusWem(take.audio.subarray(4, take.audio.length - 8)).packets).toEqual(packets);
    expect(readW3SourceTake(root, 'content/content0/enpc.w3speech#8')).toBeNull();

    const entry = w3SourceTakeEntry(clip, path.join(root, 'cache'))!;
    expect(materializeW3SourceTake(root, entry)).toBe(true);
    expect(demuxOggOpus(fs.readFileSync(entry.absolutePath)).packets).toEqual(packets);
  });
});

describe('catalog text', () => {
  it('keys every linked line by its string id', () => {
    const line: W3VoiceLine = {
      id: 42,
      relPath: 'content/content0/enpc.w3speech#42',
      container: 'content/content0/enpc.w3speech',
      speakerKey: 'unknown',
      stringId: 7,
      source: 'Hmm.',
      translationId: 3,
      status: 'reviewed',
      translation: 'Хм.',
    };
    const maps = w3VoiceTextMaps([line, { ...line, id: 43, stringId: null }]);
    expect([...maps.sourceFormids]).toEqual(['42']);
    expect(maps.translations.get('42:1')).toMatchObject({ translation: 'Хм.', source: 'Hmm.' });
  });

  it('keeps tags out of what TTS reads', () => {
    expect(WITCHER3_VOICE_MARKUP.stripEmphasis('Hold<br>on, <i>witcher</i>.')).toBe(
      'Hold on,  witcher .',
    );
  });
});
