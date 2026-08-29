import { describe, expect, it } from '@jest/globals';
import {
  collectSiblingFallbackClips,
  isUsableSpeakerDefault,
  SHORT_SIBLING_MAX_COUNT,
} from '../pickShortVoiceReferences';
import { MANUAL_REFERENCE_FORMID } from '../speakerReference/eligibility';
import type { VoiceFileEntry } from '../discoverVoiceFiles';

const entry = (
  formid: string,
  variant: number,
  fileName = `${formid}_${variant}.fuz`,
): VoiceFileEntry => ({
  relPath: `Sound/Voice/Mod.esm/NPC/${fileName}`,
  absolutePath: `/tmp/${fileName}`,
  fileName,
  formidLower6: formid,
  variant,
  ext: 'fuz',
});

describe('isUsableSpeakerDefault', () => {
  const current = entry('00AA01', 1);

  it('rejects a missing default', () => {
    expect(isUsableSpeakerDefault(null, current)).toBe(false);
  });

  it('rejects the current short take even if it was auto-picked', () => {
    expect(
      isUsableSpeakerDefault(
        { wavPath: '/missing.wav', pick: { formidLower6: '00AA01', variant: 1 }, source: 'saved' },
        current,
      ),
    ).toBe(false);
  });

  it('rejects a manual pick whose wav cannot be read', () => {
    expect(
      isUsableSpeakerDefault(
        {
          wavPath: '/missing-manual.wav',
          pick: { formidLower6: MANUAL_REFERENCE_FORMID, variant: 1 },
          source: 'manual',
        },
        current,
      ),
    ).toBe(false);
  });
});

describe('collectSiblingFallbackClips', () => {
  it('adds other takes until the 3s total or 3 extras', async () => {
    const current = entry('00AA01', 1);
    const siblings = [
      entry('00AA02', 1),
      entry('00AA03', 1),
      entry('00AA04', 1),
      entry('00AA05', 1),
    ];
    const { clips, totalSec } = await collectSiblingFallbackClips(
      current,
      siblings,
      0.4,
      async (candidate) => ({
        wavPath: `/tmp/${candidate.fileName}`,
        durationSec: candidate.formidLower6 === '00AA05' ? 2 : 0.8,
      }),
      new Map(),
    );
    expect(clips).toHaveLength(SHORT_SIBLING_MAX_COUNT);
    expect(totalSec).toBeCloseTo(0.4 + 0.8 + 0.8 + 0.8);
    expect(clips.map((clip) => clip.fileName)).toEqual([
      '00AA02_1.fuz',
      '00AA03_1.fuz',
      '00AA04_1.fuz',
    ]);
  });

  it('stops once all references reach 3 seconds', async () => {
    const current = entry('00AA01', 1);
    const { clips, totalSec } = await collectSiblingFallbackClips(
      current,
      [entry('00AA02', 1), entry('00AA03', 1)],
      0.5,
      async (candidate) => ({ wavPath: `/tmp/${candidate.fileName}`, durationSec: 2.6 }),
      new Map(),
    );
    expect(clips).toHaveLength(1);
    expect(totalSec).toBeCloseTo(3.1);
  });
});
