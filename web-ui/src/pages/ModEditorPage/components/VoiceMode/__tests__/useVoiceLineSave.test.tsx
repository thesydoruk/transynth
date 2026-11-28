import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, type VoiceLinePreview, type VoiceSpeakerLinesResponse } from '../../../../../api';
import { useVoiceLineSave } from '../hooks/useVoiceLineSave';

const line = (partial: Partial<VoiceLinePreview> = {}): VoiceLinePreview => ({
  lineKey: '825D9B',
  infoFormidHex: '00825D9B',
  variant: 1,
  fileName: '00825d9b_1.fuz',
  speakerKey: 'PlayerVoiceFemale01',
  originPlugin: 'fallout4.esm',
  stringId: 11,
  translationId: 5,
  status: 'draft',
  source: 'Hello.',
  translation: 'Привіт.',
  isReference: false,
  isInheritedAudio: false,
  inheritedFrom: null,
  isOrphanAudio: false,
  hasTranslationAudio: true,
  canGenerateVoice: false,
  ttsSkipReason: null,
  voiceSimilarity: 0.4,
  effortTag: null,
  effortAutoTag: null,
  effortOverride: null,
  effortStrength: null,
  ...partial,
});

const linesKey = ['voice-lines', 7, 'PlayerVoiceFemale01'] as const;
const speakersKey = ['voice-speakers', 7] as const;

const setup = (target: VoiceLinePreview) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The same FormID spoken by Nate: same string, its own take.
  const nate = { ...target, speakerKey: 'PlayerVoiceMale01' };
  qc.setQueryData<VoiceSpeakerLinesResponse>([...linesKey], {
    ok: true,
    speakerKey: target.speakerKey,
    lines: [target, nate],
  });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  const hook = renderHook(
    () =>
      useVoiceLineSave({
        modId: 7,
        linesQueryKey: linesKey,
        speakersQueryKey: speakersKey,
        srcLang: 'en',
        targetLang: 'uk',
      }),
    { wrapper },
  );
  const lines = () => {
    const data = qc.getQueryData<VoiceSpeakerLinesResponse>([...linesKey]);
    return data?.ok ? data.lines : [];
  };
  return { hook, lines, invalidate };
};

const calls: string[] = [];
const removeTake = () =>
  vi.spyOn(api.voiceTakes, 'removeTranslation').mockImplementation(async () => {
    calls.push('take');
    return { ok: true, takesRemoved: 1, stampsRemoved: 1 };
  });
const clearText = () =>
  vi.spyOn(api.strings, 'clearTranslation').mockImplementation(async () => {
    calls.push('text');
    return undefined as never;
  });

describe('useVoiceLineSave clearing a line', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    calls.length = 0;
  });

  it('removes the take first, then the text, and patches only that take', async () => {
    const remove = removeTake();
    clearText();
    const target = line();
    const t = setup(target);

    await act(() => t.hook.result.current.clearLine(target));

    expect(calls).toEqual(['take', 'text']);
    expect(remove).toHaveBeenCalledWith(7, target, 'en', 'uk');
    const [cleared, nate] = t.lines();
    expect(cleared).toMatchObject({
      translation: null,
      translationId: null,
      status: null,
      hasTranslationAudio: false,
      voiceSimilarity: null,
      canGenerateVoice: false,
    });
    // The text belongs to both speakers; the other take stays.
    expect(nate).toMatchObject({
      translation: null,
      hasTranslationAudio: true,
      voiceSimilarity: 0.4,
    });
    expect(t.invalidate).toHaveBeenCalledWith({ queryKey: speakersKey });
    expect(t.hook.result.current.error).toBeNull();
  });

  it('does the same when the text is emptied in the editor', async () => {
    removeTake();
    clearText();
    const target = line();
    const t = setup(target);

    await act(() => t.hook.result.current.saveLine(target, '   '));

    expect(calls).toEqual(['take', 'text']);
    expect(t.lines()[0]).toMatchObject({ translation: null, hasTranslationAudio: false });
  });

  it('changes nothing when the take cannot be removed', async () => {
    vi.spyOn(api.voiceTakes, 'removeTranslation').mockRejectedValue(
      new Error('Voice line not found'),
    );
    const clear = clearText();
    const target = line();
    const t = setup(target);

    await act(() => t.hook.result.current.clearLine(target));

    expect(clear).not.toHaveBeenCalled();
    expect(t.lines()[0]).toEqual(target);
    expect(t.hook.result.current.error).toBe('Voice line not found');
  });

  it('shows the text without the take when only the text could not be cleared', async () => {
    removeTake();
    vi.spyOn(api.strings, 'clearTranslation').mockRejectedValue(new Error('offline'));
    const target = line();
    const t = setup(target);

    await act(() => t.hook.result.current.clearLine(target));

    expect(t.lines()[0]).toMatchObject({
      translation: 'Привіт.',
      hasTranslationAudio: false,
      voiceSimilarity: null,
      canGenerateVoice: true,
    });
    expect(t.hook.result.current.error).toBe('offline');
  });

  it('asks only for what the line has', async () => {
    const remove = removeTake();
    const clear = clearText();

    const undubbed = line({ hasTranslationAudio: false, voiceSimilarity: null });
    // Rendered outside `act`: inside it the hook has no result yet.
    const first = setup(undubbed);
    await act(() => first.hook.result.current.clearLine(undubbed));
    expect(remove).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledTimes(1);

    const takeOnly = line({ translation: null, translationId: null, status: null });
    const t = setup(takeOnly);
    await act(() => t.hook.result.current.clearLine(takeOnly));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(t.lines()[0]).toMatchObject({ hasTranslationAudio: false });

    // An editor closed on an empty line does not touch its take.
    await act(() => t.hook.result.current.saveLine(takeOnly, ''));
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
