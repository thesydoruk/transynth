/**
 * Building a `.wem` + `.ffxanim` take, with real audio: ffmpeg decodes the
 * source take and encodes the new one; only the TTS server and the lip
 * animation service are stand-ins.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Tx } from '../../db';
import type { WemTakeCodec } from '../../formats/wem';
import type { FaceFxActorSex } from '../faceFx/generateFfxanim';
import type { VoiceTtsRefClip } from '../pickVoiceTtsReference';
import type { PrepareVoiceTtsTextResult } from '../prepareVoiceTtsText';
import type { VoiceTranslationRow } from '../voiceTextRows';
import { touch, wemInfo, wemWithFormatTag, writePlugin, writeToneWav } from './wemFixtures';

// The game registry (test setup) already evaluated the voice modules; start
// from an empty registry so the mocks below are what the modules under test link to.
jest.resetModules();

type FfxanimCall = {
  game: string;
  wavPath: string;
  wavBytes: Buffer;
  text: string;
  actor: FaceFxActorSex;
};
const ffxanimCalls: FfxanimCall[] = [];
let writeFfxanim = true;

jest.unstable_mockModule('../faceFx/generateFfxanim', () => ({
  generateFfxanimFile: async (
    game: string,
    wavPath: string,
    ffxanimPath: string,
    text: string,
    actor: FaceFxActorSex,
  ) => {
    ffxanimCalls.push({ game, wavPath, wavBytes: fs.readFileSync(wavPath), text, actor });
    if (writeFfxanim) fs.writeFileSync(ffxanimPath, `ffxanim:${path.basename(wavPath)}`);
  },
}));

let ttsWav: Buffer = Buffer.alloc(0);
const ttsCalls: Array<{ text: string; clips: VoiceTtsRefClip[] }> = [];
jest.unstable_mockModule('../../tts/ttsClient', () => ({
  synthesizeWav: async (text: string, clips: VoiceTtsRefClip[]) => {
    ttsCalls.push({ text, clips });
    return { wav: ttsWav, voiceSimilarity: 0.61, takes: 1 };
  },
}));

jest.unstable_mockModule('../pickVoiceTtsReference', () => ({
  pickVoiceTtsReference: async (input: { lineEnglishWav: string }) => ({
    clips: [{ wavPath: input.lineEnglishWav }],
    strategy: 'line',
  }),
}));

const recorded: Array<{ takePath: string; stamp: Record<string, unknown> }> = [];
jest.unstable_mockModule('../referenceVoiceTakeHooks', () => ({
  recordVoiceTake: async (_db: Tx, files: { takePath: string }, stamp: Record<string, unknown>) => {
    recorded.push({ takePath: files.takePath, stamp });
  },
  voiceTakeSource: (entry: { relPath: string; absolutePath: string }) => ({
    source: { relPath: entry.relPath, absPath: entry.absolutePath },
  }),
  saveReferenceVoiceTakeForLine: async () => 'saved',
}));

const { describeWem, parseOpusWem, wemTakeCodec } = await import('../../formats/wem');
const { buildVoicedWemFromTtsWav } = await import('../synthesizeVoicedWem');
const { wemFfxanimTakes } = await import('../takeFormat');
const { processVoiceLocalizeEntry } = await import('../processVoiceLocalizeEntry');
const { prepareReferenceAudio } = await import('../prepareReferenceAudio');
const { _resetInfoVoiceResponseCacheForTests } = await import('../infoResponseNumbers');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wem-take-build-'));
const TTS_SECONDS = 1.4;
const codec = wemTakeCodec('opus');

const wavSeconds = (wav: Buffer): number => {
  const data = wav.indexOf(Buffer.from('data', 'latin1'), 12);
  return wav.readUInt32LE(data + 4) / wav.readUInt32LE(28);
};

let sourceTake: Buffer = Buffer.alloc(0);

beforeAll(async () => {
  // What the TTS server returns: 24 kHz, not the rate a take is encoded from.
  ttsWav = fs.readFileSync(await writeToneWav(path.join(root, 'tts.wav'), TTS_SECONDS, 24000));
  const original = await writeToneWav(path.join(root, 'original.wav'), 1, 48000);
  sourceTake = await codec.encodeFromWav(original, { sourceTake: null });
}, 60_000);

afterAll(() => {
  _resetInfoVoiceResponseCacheForTests();
  fs.rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  ffxanimCalls.length = 0;
  ttsCalls.length = 0;
  recorded.length = 0;
  writeFfxanim = true;
});

const workDir = (name: string): string => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

describe('buildVoicedWemFromTtsWav', () => {
  it('makes the take and the lip animation from one WAV, equally long', async () => {
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

    expect(describeWem(built.data).codec).toBe('opus');
    expect(built.sidecars.map((sidecar) => sidecar.extension)).toEqual(['.ffxanim']);
    expect(built.sidecars[0]!.data.toString()).toBe('ffxanim:00ae4a02.wav');

    expect(ffxanimCalls).toHaveLength(1);
    const call = ffxanimCalls[0]!;
    expect([call.game, call.text, call.actor]).toEqual(['fo4', 'Привіт, капітане.', 'female']);
    // The animation was timed on a 48 kHz WAV — the very samples that were encoded.
    expect(call.wavBytes.readUInt32LE(24)).toBe(48000);
    expect(call.wavBytes.equals(built.previewWav!)).toBe(true);

    const take = parseOpusWem(built.data);
    expect(take.samples / take.sampleRate).toBeCloseTo(wavSeconds(call.wavBytes), 6);
    expect(take.samples).toBe(Math.round(TTS_SECONDS * 48000));
  }, 60_000);

  it('uses the male rig when the speaker is unknown, and mirrors the source take', async () => {
    const source = path.join(root, 'source-nohash.wem');
    const parsed = parseOpusWem(sourceTake);
    const { buildOpusWem } = await import('../../formats/wem');
    fs.writeFileSync(
      source,
      buildOpusWem({
        packets: parsed.packets,
        channels: 1,
        samples: parsed.samples,
        preSkip: parsed.preSkip,
        hash: null,
      }),
    );

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
    expect(ffxanimCalls[0]!.actor).toBe('male');
    expect(parseOpusWem(built.data).hasHashChunk).toBe(false);
    expect(built.previewWav).toBeUndefined();
  }, 60_000);

  it('fails when the lip animation did not appear', async () => {
    writeFfxanim = false;
    await expect(
      buildVoicedWemFromTtsWav(
        { game: 'fo4', ttsWav, workDir: workDir('three'), fileName: '00000b02.wem', text: 'x' },
        codec,
      ),
    ).rejects.toThrow(/Lip animation was not created: 00000b02\.ffxanim/);
  }, 60_000);

  it('refuses a take whose length left the audio its animation was made from', async () => {
    const padding: WemTakeCodec = {
      ...codec,
      durationSeconds: (take) => codec.durationSeconds(take) + 0.5,
    };
    await expect(
      buildVoicedWemFromTtsWav(
        { game: 'fo4', ttsWav, workDir: workDir('four'), fileName: '00000b03.wem', text: 'x' },
        padding,
      ),
    ).rejects.toThrow(/0\.500s off the audio its lip animation was made from/);
  }, 60_000);
});

describe('one line of a mod-wide job, with .wem takes', () => {
  const takes = wemFfxanimTakes('opus');
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

  const run = (
    entry: ReturnType<typeof takes.discover>[number],
    storedVersions = new Map<string, string>(),
  ) =>
    processVoiceLocalizeEntry(entry, row, prepared, {
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
      speakerSexOf: (speaker) => (speaker === 'NPCFAndreja' ? 'female' : 'male'),
      ttsBaseUrl: 'http://tts.invalid',
      referenceMode: 'line',
      synthesis: {} as never,
      tgtLang: 'uk',
      force: false,
      voiceSources: new Map(),
      speakerRefCache: new Map(),
      getSiblingEntries: () => [],
      storedVersions,
    });

  beforeAll(() => {
    writePlugin(
      path.join(packageDir, 'Mod.esm'),
      [],
      [
        wemInfo(0x00000800, [{ wemId: 0x00ae4a02, text: 'Hello, Captain.' }]),
        wemInfo(0x00000801, [{ wemId: 0x00ae4a03, text: 'Vorbis line.' }]),
      ],
    );
    const voice = path.join(packageDir, 'Sound', 'Voice', 'Mod.esm', 'NPCFAndreja');
    touch(path.join(voice, '00ae4a02.wem'), sourceTake);
    touch(path.join(voice, '00ae4a03.wem'), wemWithFormatTag(0xffff));
  });

  it('decodes the source take, and writes the dub and its animation under the same id', async () => {
    const entry = takes.discover(packageDir, 'Mod.esm').find((take) => take.lineKey === '000800')!;
    const result = await run(entry);

    expect(result).toEqual({
      kind: 'written',
      relPath: 'Sound/Voice/Mod.esm/NPCFAndreja/00ae4a02.wem',
      voiceSimilarity: 0.61,
    });
    // The reference clip handed to TTS was the decoded Opus take.
    expect(ttsCalls).toHaveLength(1);
    expect(ttsCalls[0]!.text).toBe('Привіт, капітане.');
    expect(ffxanimCalls[0]!.actor).toBe('female');

    const dub = path.join(localizeDir, 'Sound', 'Voice', 'Mod.esm', 'NPCFAndreja', '00ae4a02.wem');
    const animation = dub.replace(/\.wem$/, '.ffxanim');
    expect(describeWem(fs.readFileSync(dub)).codec).toBe('opus');
    expect(fs.readFileSync(animation, 'utf8')).toBe('ffxanim:00ae4a02.wav');
    expect(parseOpusWem(fs.readFileSync(dub)).samples).toBe(Math.round(TTS_SECONDS * 48000));

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.takePath).toBe(dub);
    expect(recorded[0]!.stamp).toMatchObject({
      lineKey: '000800',
      variant: 1,
      speakerKey: 'NPCFAndreja',
      originPlugin: 'mod.esm',
      targetLang: 'uk',
      voiceSimilarity: 0.61,
    });
  }, 120_000);

  it('leaves a current take alone, and redoes one that lost its animation', async () => {
    const entry = takes.discover(packageDir, 'Mod.esm').find((take) => take.lineKey === '000800')!;
    const dub = path.join(localizeDir, 'Sound', 'Voice', 'Mod.esm', 'NPCFAndreja', '00ae4a02.wem');
    const animation = dub.replace(/\.wem$/, '.ffxanim');
    const { voiceTtsPayloadVersionFromPrepared } = await import('../voiceTtsPayloadVersion');
    const { voiceSynthesisStateKey } = await import('../voiceSynthesisState');
    const stamped = (): Map<string, string> =>
      new Map([
        [
          voiceSynthesisStateKey('NPCFAndreja', '000800', 1, 'mod.esm'),
          voiceTtsPayloadVersionFromPrepared(prepared, 'uk'),
        ],
      ]);

    expect((await run(entry, stamped())).kind).toBe('skipped');
    expect(ttsCalls).toHaveLength(0);

    // Without its animation the take is not there: the line is synthesized again.
    // (This stand-in TTS returns the same audio, so the take itself comes out unchanged.)
    fs.rmSync(animation);
    await run(entry, stamped());
    expect(ttsCalls).toHaveLength(1);
    expect(fs.existsSync(animation)).toBe(true);
  }, 120_000);

  it('reports a source take in an unimplemented codec by its name and tag', async () => {
    const entry = takes.discover(packageDir, 'Mod.esm').find((take) => take.lineKey === '000801')!;
    const result = await run(entry);
    expect(result.kind).toBe('warning');
    expect(result.kind === 'warning' && result.message).toMatch(
      /Sound\/Voice\/Mod\.esm\/NPCFAndreja\/00ae4a03\.wem: Unsupported WEM codec: the take is Wwise Vorbis \(fmt tag 0xffff\)/,
    );
    expect(ttsCalls).toHaveLength(0);

    await expect(prepareReferenceAudio(entry, workDir('ref'))).rejects.toThrow(/Wwise Vorbis/);
  });
});
