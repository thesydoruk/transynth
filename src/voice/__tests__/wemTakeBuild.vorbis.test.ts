/**
 * The `.wem` + `.ffxanim` take builder and one line of a voice job with Wwise
 * Vorbis takes — Starfield's codec — and real audio: ffmpeg decodes the source
 * take and encodes the new one; only the TTS server and the lip animation
 * service are stand-ins. `wemTakeBuild.test.ts` covers the same path for Opus.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import type { FaceFxActorSex } from '../faceFx/generateFfxanim';
import type { VoiceTtsRefClip } from '../pickVoiceTtsReference';
import type { PrepareVoiceTtsTextResult } from '../prepareVoiceTtsText';
import type { VoiceTranslationRow } from '../voiceTextRows';
import { touch, wemInfo, writePlugin, writeToneWav } from './wemFixtures';

// The game registry (test setup) already evaluated the voice modules; start
// from an empty registry so the mocks below are what the modules under test link to.
jest.resetModules();

const ffxanimCalls: Array<{ wavBytes: Buffer; actor: FaceFxActorSex }> = [];
jest.unstable_mockModule('../faceFx/generateFfxanim', () => ({
  generateFfxanimFile: async (
    _game: string,
    wavPath: string,
    ffxanimPath: string,
    _text: string,
    actor: FaceFxActorSex,
  ) => {
    ffxanimCalls.push({ wavBytes: fs.readFileSync(wavPath), actor });
    fs.writeFileSync(ffxanimPath, `ffxanim:${path.basename(wavPath)}`);
  },
}));

let ttsWav: Buffer = Buffer.alloc(0);
const ttsCalls: Array<{ clips: VoiceTtsRefClip[]; reference: Buffer }> = [];
jest.unstable_mockModule('../../tts/ttsClient', () => ({
  synthesizeWav: async (_text: string, clips: VoiceTtsRefClip[]) => {
    ttsCalls.push({ clips, reference: fs.readFileSync(clips[0]!.wavPath) });
    return { wav: ttsWav, voiceSimilarity: 0.61, takes: 1 };
  },
}));

jest.unstable_mockModule('../pickVoiceTtsReference', () => ({
  pickVoiceTtsReference: async (input: { lineEnglishWav: string }) => ({
    clips: [{ wavPath: input.lineEnglishWav }],
    strategy: 'line',
  }),
}));

jest.unstable_mockModule('../referenceVoiceTakeHooks', () => ({
  recordVoiceTake: async () => undefined,
  voiceTakeSource: (entry: { relPath: string; absolutePath: string }) => ({
    source: { relPath: entry.relPath, absPath: entry.absolutePath },
  }),
  saveReferenceVoiceTakeForLine: async () => 'saved',
}));

const { describeWem, parseVorbisWem, wemTakeCodec } = await import('../../formats/wem');
const { buildVoicedWemFromTtsWav } = await import('../synthesizeVoicedWem');
const { wemFfxanimTakes } = await import('../takeFormat');
const { processVoiceLocalizeEntry } = await import('../processVoiceLocalizeEntry');
const { _resetInfoVoiceResponseCacheForTests } = await import('../infoResponseNumbers');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wem-take-build-vorbis-'));
const TTS_SECONDS = 1.4;
const codec = wemTakeCodec('vorbis');

const wavHeader = (wav: Buffer): { sampleRate: number; samples: number } => {
  const data = wav.indexOf(Buffer.from('data', 'latin1'), 12);
  return { sampleRate: wav.readUInt32LE(24), samples: wav.readUInt32LE(data + 4) / 2 };
};

/** A source take at 32 kHz, as a tenth of the game's own are. */
let sourceTake32: Buffer = Buffer.alloc(0);

beforeAll(async () => {
  // What the TTS server returns: 24 kHz, not the rate a take is encoded from.
  ttsWav = fs.readFileSync(await writeToneWav(path.join(root, 'tts.wav'), TTS_SECONDS, 24000));
  const original = await writeToneWav(path.join(root, 'original.wav'), 1, 32000);
  sourceTake32 = await codec.encodeFromWav(original, { sourceTake: null });
}, 60_000);

afterAll(() => {
  _resetInfoVoiceResponseCacheForTests();
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  ffxanimCalls.length = 0;
  ttsCalls.length = 0;
});

const workDir = (name: string): string => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

describe('buildVoicedWemFromTtsWav with Wwise Vorbis', () => {
  it('makes a 44.1 kHz take exactly as long as the WAV its animation was timed on', async () => {
    const built = await buildVoicedWemFromTtsWav(
      {
        game: 'fo4',
        ttsWav,
        workDir: workDir('one'),
        fileName: '00ae4a02.wem',
        text: 'Привіт, капітане.',
        actor: 'female',
        includePreviewWav: true,
      },
      codec,
    );

    expect(describeWem(built.data)).toMatchObject({ codec: 'vorbis', sampleRate: 44100 });
    expect(built.sidecars.map((sidecar) => sidecar.extension)).toEqual(['.ffxanim']);

    const timedOn = wavHeader(ffxanimCalls[0]!.wavBytes);
    expect(timedOn.sampleRate).toBe(44100);
    expect(timedOn.samples).toBe(Math.round(TTS_SECONDS * 44100));
    expect(ffxanimCalls[0]!.wavBytes.equals(built.previewWav!)).toBe(true);
    // Not within the 20 ms the builder tolerates: the same sample count.
    expect(parseVorbisWem(built.data).samples).toBe(timedOn.samples);
  }, 60_000);

  it('follows the sample rate of the take it replaces', async () => {
    const source = touch(path.join(root, 'source32.wem'), sourceTake32);
    const built = await buildVoicedWemFromTtsWav(
      {
        game: 'fo4',
        ttsWav,
        workDir: workDir('two'),
        fileName: '00000b01.wem',
        text: 'Line.',
        sourceTakePath: source,
      },
      codec,
    );
    const timedOn = wavHeader(ffxanimCalls[0]!.wavBytes);
    expect(timedOn.sampleRate).toBe(32000);
    expect(parseVorbisWem(built.data)).toMatchObject({
      sampleRate: 32000,
      samples: timedOn.samples,
    });
  }, 60_000);
});

describe('one line of a mod-wide job, with Wwise Vorbis takes', () => {
  const takes = wemFfxanimTakes('vorbis');
  const packageDir = path.join(root, 'mod');
  const localizeDir = path.join(root, 'localize');
  const db = { query: async () => ({ rows: [] }) } as unknown as Tx;

  const row: VoiceTranslationRow = {
    lineKey: '000800',
    infoFormidHex: '00000800',
    originPlugin: 'mod.esm',
    voiceVariant: 1,
    stringId: 7,
    translationId: 70,
    status: 'reviewed',
    translation: 'Привіт, капітане.',
    source: 'Hello, Captain.',
    edid: null,
  };
  const prepared = {
    action: 'synthesize',
    text: 'Привіт, капітане.',
  } as Extract<PrepareVoiceTtsTextResult, { action: 'synthesize' }>;

  beforeAll(() => {
    writePlugin(
      path.join(packageDir, 'Mod.esm'),
      [],
      [wemInfo(0x00000800, [{ wemId: 0x00ae4a02, text: 'Hello, Captain.' }])],
    );
    const voice = path.join(packageDir, 'Sound', 'Voice', 'Mod.esm', 'NPCFAndreja');
    touch(path.join(voice, '00ae4a02.wem'), sourceTake32);
  });

  it('decodes the Vorbis source take for the reference and writes a Vorbis dub', async () => {
    const entry = takes.discover(packageDir, 'Mod.esm').find((take) => take.lineKey === '000800')!;
    const result = await processVoiceLocalizeEntry(entry, row, prepared, {
      db,
      modId: 1,
      packageDir,
      pluginRel: 'Mod.esm',
      voiceRootRel: 'Sound/Voice/Mod.esm',
      localizeDir,
      prefix: '',
      tempRoot: workDir('job'),
      game: 'fo4',
      takes,
      speakerSexOf: () => 'female',
      ttsBaseUrl: 'http://tts.invalid',
      referenceMode: 'line',
      synthesis: {} as never,
      tgtLang: 'uk',
      force: false,
      voiceSources: new Map(),
      speakerRefCache: new Map(),
      getSiblingEntries: () => [],
      storedVersions: new Map(),
    });

    expect(result).toEqual({
      kind: 'written',
      relPath: 'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a02.wem',
      voiceSimilarity: 0.61,
    });
    // The reference clip handed to TTS was the decoded Vorbis take: one second of audio.
    expect(ttsCalls).toHaveLength(1);
    const reference = wavHeader(ttsCalls[0]!.reference);
    expect(reference.samples / reference.sampleRate).toBeCloseTo(1, 2);

    const dub = path.join(localizeDir, 'Sound', 'Voice', 'Mod.esm', 'NPCFAndreja', '00ae4a02.wem');
    const written = parseVorbisWem(fs.readFileSync(dub));
    expect(describeWem(fs.readFileSync(dub)).codec).toBe('vorbis');
    expect(written.sampleRate).toBe(32000);
    expect(written.samples).toBe(Math.round(TTS_SECONDS * 32000));
    expect(fs.readFileSync(dub.replace(/\.wem$/, '.ffxanim'), 'utf8')).toBe('ffxanim:00ae4a02.wav');
  }, 120_000);
});
