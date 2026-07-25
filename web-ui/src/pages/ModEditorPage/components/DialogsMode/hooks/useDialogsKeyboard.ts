import { useEffect, useRef } from 'react';
import type { DialogScope } from '../../../../../api';

/** Callbacks the dialogs hotkeys drive. */
export interface DialogsKeyboardConfig {
  setScope: (scope: DialogScope) => void;
  /** Move the navigator selection by whole groups. */
  stepGroup: (delta: number) => void;
  /** Move the line cursor inside the transcript. */
  stepLine: (delta: number) => void;
  goToNextTodo: () => void;
  edit: () => void;
  /** Play the voice-over of the focused line, if it has one. */
  playVoice: () => void;
  clearFocus: () => void;
  focusSearch: () => void;
  /** True while a line editor holds the caret. */
  isEditing: boolean;
}

const SCOPE_KEYS: Record<string, DialogScope> = {
  '1': 'topics',
  '2': 'branches',
  '3': 'scenes',
  '4': 'conversations',
};

/**
 * Global hotkeys of the dialogs editor.
 *
 * Modified keys stay live everywhere so the user can jump between groups
 * without leaving the text area; unmodified keys are ignored while typing.
 */
export const useDialogsKeyboard = (config: DialogsKeyboardConfig): void => {
  const ref = useRef(config);
  ref.current = config;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const c = ref.current;
      const tag = (event.target as HTMLElement | null)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault();
        c.stepGroup(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape' && !c.isEditing) {
        event.preventDefault();
        c.clearFocus();
        return;
      }

      if (isTyping) return;

      const scope = SCOPE_KEYS[event.key];
      if (scope) {
        event.preventDefault();
        c.setScope(scope);
        return;
      }

      if (event.key === '/') {
        event.preventDefault();
        c.focusSearch();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        c.stepLine(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }

      if (event.key === 'n') {
        event.preventDefault();
        c.goToNextTodo();
        return;
      }

      if (event.key === 'p') {
        event.preventDefault();
        c.playVoice();
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        c.edit();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
};
