import { useEffect, useRef } from 'react';

export interface VoiceKeyboardConfig {
  stepLine: (delta: number) => void;
  goToNextTodo: () => void;
  edit: () => void;
  playVoice: () => void;
  clearFocus: () => void;
  isEditing: boolean;
}

/** Global hotkeys for the voice line list (mirrors the dialogs transcript). */
export const useVoiceKeyboard = (config: VoiceKeyboardConfig): void => {
  const ref = useRef(config);
  ref.current = config;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const c = ref.current;
      const tag = (event.target as HTMLElement | null)?.tagName;
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape' && !c.isEditing) {
        event.preventDefault();
        c.clearFocus();
        return;
      }

      if (isTyping) return;

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
