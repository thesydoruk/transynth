import { describe, expect, it } from '@jest/globals';
import { parseVoiceResynthBody } from '../modVoiceGenerate';

describe('parseVoiceResynthBody', () => {
  const good = { similarityBelow: 0.4, targetSimilarity: 0.45, retries: 6, noWorse: false };

  it('accepts the dialog fields and defaults "no worse" to on', () => {
    expect(parseVoiceResynthBody({ scope: 'low-similarity', ...good })).toEqual({
      ok: true,
      params: good,
    });
    expect(parseVoiceResynthBody({ ...good, noWorse: undefined })).toMatchObject({
      params: { noWorse: true },
    });
  });

  it('rejects a missing or out-of-range threshold or target', () => {
    expect(parseVoiceResynthBody({ ...good, similarityBelow: undefined })).toMatchObject({
      ok: false,
      error: expect.stringContaining('similarityBelow'),
    });
    expect(parseVoiceResynthBody({ ...good, similarityBelow: 1.2 })).toMatchObject({ ok: false });
    expect(parseVoiceResynthBody({ ...good, targetSimilarity: -0.1 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('targetSimilarity'),
    });
    expect(parseVoiceResynthBody({ ...good, similarityBelow: Number.NaN })).toMatchObject({
      ok: false,
    });
  });

  it('rejects a retry budget that is not an integer in the allowed range', () => {
    expect(parseVoiceResynthBody({ ...good, retries: 2.5 })).toMatchObject({
      ok: false,
      error: expect.stringContaining('retries'),
    });
    expect(parseVoiceResynthBody({ ...good, retries: 9 })).toMatchObject({ ok: false });
    expect(parseVoiceResynthBody({ ...good, retries: -1 })).toMatchObject({ ok: false });
    expect(parseVoiceResynthBody({ ...good, retries: 0 })).toMatchObject({ ok: true });
    expect(parseVoiceResynthBody({ ...good, retries: 8 })).toMatchObject({ ok: true });
  });

  it('rejects a non-boolean "no worse"', () => {
    expect(parseVoiceResynthBody({ ...good, noWorse: 'yes' as unknown as boolean })).toMatchObject({
      ok: false,
      error: expect.stringContaining('noWorse'),
    });
  });
});
