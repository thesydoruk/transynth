import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { effortTagsConfirmMessage, effortTagsHint } from '../effortTagsCopy';

/** Echoes the key and its options, so the test sees which message was picked. */
const t = ((key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key) as unknown as TFunction;

const summary = (analyzedMods: number, taggedTakes: number, synthesizedTaggedTakes: number) => ({
  analyzedMods,
  taggedTakes,
  synthesizedTaggedTakes,
});

describe('effortTagsConfirmMessage', () => {
  it('says how many takes go stale', () => {
    expect(effortTagsConfirmMessage(t, summary(2, 600, 480))).toBe(
      'settings.voice.effortTagsConfirmStale {"count":480}',
    );
  });

  it('says nothing changes until a mod is analyzed', () => {
    expect(effortTagsConfirmMessage(t, summary(0, 0, 0))).toBe(
      'settings.voice.effortTagsConfirmNotAnalyzed',
    );
  });

  it('says nothing goes stale when no tagged line is voiced yet', () => {
    expect(effortTagsConfirmMessage(t, summary(1, 40, 0))).toBe(
      'settings.voice.effortTagsConfirmNoneStale {"tagged":40}',
    );
  });

  it('falls back to what happens in general without numbers', () => {
    expect(effortTagsConfirmMessage(t, undefined)).toBe('settings.voice.effortTagsConfirmUnknown');
  });
});

describe('effortTagsHint', () => {
  it('lists the analyzed mods, tagged lines and voiced tagged lines', () => {
    expect(effortTagsHint(t, summary(3, 600, 480))).toBe(
      'settings.voice.effortTagsSummary {"mods":3,"tagged":600,"synthesized":480}',
    );
  });
});
