import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StringRow } from '../../../../api';
import { useAutosave } from '../useAutosave';

const row = (string_id: number, translation: string | null): StringRow =>
  ({ string_id, translation, source: 'Sturges' }) as StringRow;

describe('useAutosave', () => {
  let onSave: ReturnType<typeof vi.fn<(stringId: number, text: string) => void>>;
  let onClear: ReturnType<typeof vi.fn<(stringId: number) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    onSave = vi.fn();
    onClear = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const render = (activeRow: StringRow | null, draftTranslation: string) =>
    renderHook(
      (props: { activeRow: StringRow | null; draftTranslation: string }) =>
        useAutosave({ ...props, onSave, onClear }),
      { initialProps: { activeRow, draftTranslation } },
    );

  it('saves 800 ms after the last keystroke, with the latest text', () => {
    const active = row(1, 'Стьорджес');
    const hook = render(active, 'Стьорджес');

    hook.rerender({ activeRow: active, draftTranslation: 'Сте' });
    act(() => vi.advanceTimersByTime(500));
    hook.rerender({ activeRow: active, draftTranslation: 'Стерджес' });
    act(() => vi.advanceTimersByTime(799));
    expect(onSave).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(1, 'Стерджес');
  });

  it('clears the translation when the text is erased', () => {
    const active = row(1, 'Стерджес');
    const hook = render(active, 'Стерджес');

    hook.rerender({ activeRow: active, draftTranslation: '   ' });
    act(() => vi.advanceTimersByTime(800));

    expect(onClear).toHaveBeenCalledWith(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does nothing while the text matches what is saved', () => {
    const active = row(1, 'Стерджес');
    const hook = render(active, 'Стерджес');

    hook.rerender({ activeRow: active, draftTranslation: 'Стерджес!' });
    hook.rerender({ activeRow: active, draftTranslation: 'Стерджес' });
    act(() => vi.advanceTimersByTime(2000));

    expect(onSave).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('flushAutosave saves at once and leaves nothing pending', () => {
    const active = row(1, null);
    const hook = render(active, '');
    hook.rerender({ activeRow: active, draftTranslation: 'Стерджес' });

    act(() => hook.result.current.flushAutosave());
    act(() => vi.advanceTimersByTime(2000));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(1, 'Стерджес');
  });

  it('cancelAutosave drops the pending save', () => {
    const active = row(1, null);
    const hook = render(active, '');
    hook.rerender({ activeRow: active, draftTranslation: 'Стерджес' });

    act(() => hook.result.current.cancelAutosave());
    act(() => vi.advanceTimersByTime(2000));

    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps its helpers stable across renders', () => {
    const active = row(1, null);
    const hook = render(active, '');
    const first = hook.result.current;

    hook.rerender({ activeRow: active, draftTranslation: 'x' });

    expect(hook.result.current.flushAutosave).toBe(first.flushAutosave);
    expect(hook.result.current.cancelAutosave).toBe(first.cancelAutosave);
  });

  // Leaving the editor (a nav link, the back button) within the debounce window
  // must not throw away what was just typed.
  it('saves a pending edit when the editor closes before the timer fires', () => {
    const active = row(1, null);
    const hook = render(active, '');
    hook.rerender({ activeRow: active, draftTranslation: 'Стерджес' });

    hook.unmount();

    expect(onSave).toHaveBeenCalledWith(1, 'Стерджес');
  });

  it('does not save twice when the timer already saved before the editor closed', () => {
    const active = row(1, null);
    const hook = render(active, '');
    hook.rerender({ activeRow: active, draftTranslation: 'Стерджес' });
    act(() => vi.advanceTimersByTime(800));

    hook.unmount();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  // The editor wires onSave to a TanStack mutation declared before the autosave
  // hook, so on the way out the mutation observer is already unsubscribed. The
  // request must still go out.
  it('still reaches the server through a mutation when the editor closes', async () => {
    vi.useRealTimers();
    const saved = vi.fn(async (_vars: { stringId: number; text: string }) => ({ ok: true }));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children);
    const active = row(1, null);
    const hook = renderHook(
      ({ draftTranslation }: { draftTranslation: string }) => {
        const mutation = useMutation({ mutationFn: saved });
        return useAutosave({
          activeRow: active,
          draftTranslation,
          onSave: (stringId, text) => mutation.mutate({ stringId, text }),
          onClear: () => {},
        });
      },
      { wrapper, initialProps: { draftTranslation: '' } },
    );
    hook.rerender({ draftTranslation: 'Стерджес' });

    hook.unmount();
    await vi.waitFor(() => expect(saved).toHaveBeenCalled());

    expect(saved.mock.calls[0]![0]).toEqual({ stringId: 1, text: 'Стерджес' });
  });
});
