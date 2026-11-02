import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Tx } from '../../../db';
import type { VoiceFileEntry } from '../../discoverVoiceFiles';

// The game registry (test setup) already evaluated the voice modules; start
// from an empty registry so the mocks below are what the module under test links to.
jest.resetModules();

const decodeMock = jest.fn<(entry: VoiceFileEntry) => Promise<string>>();

jest.unstable_mockModule('../cache', () => ({
  entryReferenceId: (entry: VoiceFileEntry) => `${entry.lineKey}_${entry.variant}`,
  sourceDigest: () => 'digest',
  getOrDecodeEntryReferenceWav: (entry: VoiceFileEntry) => decodeMock(entry),
  getOrReuseSpeakerReferenceWav: async (
    _speaker: string,
    _dir: string,
    _marker: string,
    produce: () => Promise<string>,
  ) => produce(),
}));

// Duration is encoded in the file name so each take ranks predictably.
jest.unstable_mockModule('../scoring', () => ({
  analyzeReferenceWav: (wavPath: string) => {
    const durationSec = Number(/_d(\d+)\.wav$/.exec(wavPath)?.[1] ?? 0);
    return { score: 50, durationSec, activeSec: durationSec };
  },
}));

// Imported after the mocks: a static import would load the real cache first.
const { autoSelectReference, spreadCandidates } = await import('../autoSelectScan');
const { AUTO_SELECT_MAX_CANDIDATES, AUTO_SELECT_PREFERRED_STOP_COUNT } =
  await import('../constants');

const entry = (index: number, durationSec: number): VoiceFileEntry => ({
  relPath: `Sound/Voice/Mod.esp/Speaker/${index}_d${durationSec}.wav`,
  absolutePath: `/pkg/${index}_d${durationSec}.wav`,
  fileName: `${index}_d${durationSec}`,
  lineKey: index.toString(16).toUpperCase().padStart(8, '0'),
  variant: 1,
  ext: 'wav',
});

const db = { query: async () => ({ rows: [] }) } as unknown as Tx;
const dirs = { speaker: '/cache/speaker', entry: '/cache/entry', work: '/cache/work' };

const scan = (siblings: VoiceFileEntry[], signal?: AbortSignal) =>
  autoSelectReference(
    {
      db,
      modId: 1,
      speakerKey: 'Speaker',
      preferredEntry: entry(0, 3),
      getFallbackEntries: () => siblings,
      packageDir: '/pkg',
      pluginRelPath: 'Mod.esp',
      signal,
    },
    dirs,
    () => true,
  );

beforeEach(() => {
  decodeMock.mockReset();
  decodeMock.mockImplementation(async (take) => `/decoded/${take.fileName}.wav`);
});

describe('spreadCandidates', () => {
  it('keeps a small pool whole and in order', () => {
    expect(spreadCandidates([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  it('samples a large pool evenly from its start', () => {
    const pool = Array.from({ length: 100 }, (_, i) => i);
    expect(spreadCandidates(pool, 4)).toEqual([0, 25, 50, 75]);
  });
});

describe('autoSelectReference scan budget', () => {
  it('stops once enough 8–12 s takes are ranked', async () => {
    const siblings = Array.from({ length: 1000 }, (_, i) => entry(i + 1, 10));
    const result = await scan(siblings);
    expect(result?.source).toBe('auto');
    // the preferred (3 s) line plus the early-stop quota of siblings
    expect(decodeMock).toHaveBeenCalledTimes(1 + AUTO_SELECT_PREFERRED_STOP_COUNT);
  });

  it('decodes at most the candidate cap when nothing is 8–12 s', async () => {
    const siblings = Array.from({ length: 5000 }, (_, i) => entry(i + 1, 5));
    const result = await scan(siblings);
    expect(result?.source).toBe('auto');
    expect(decodeMock).toHaveBeenCalledTimes(1 + AUTO_SELECT_MAX_CANDIDATES);
  });

  it('still ranks a small pool in full', async () => {
    const siblings = [entry(1, 5), entry(2, 20), entry(3, 9)];
    const result = await scan(siblings);
    expect(result?.pick.lineKey).toBe(entry(3, 9).lineKey);
    expect(decodeMock).toHaveBeenCalledTimes(4);
  });
});

describe('autoSelectReference cancellation', () => {
  it('rejects before decoding anything when already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(scan([entry(1, 10)], controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(decodeMock).not.toHaveBeenCalled();
  });

  it('stops the sibling scan when cancelled mid-way', async () => {
    const controller = new AbortController();
    const siblings = Array.from({ length: 50 }, (_, i) => entry(i + 1, 5));
    decodeMock.mockImplementation(async (take) => {
      if (take.fileName === siblings[2]!.fileName) controller.abort();
      return `/decoded/${take.fileName}.wav`;
    });
    await expect(scan(siblings, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    // preferred + three siblings, the third of which fired the cancel
    expect(decodeMock).toHaveBeenCalledTimes(4);
  });
});
