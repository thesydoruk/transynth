import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { VoiceEffortChoice, VoiceLinePreview } from '../../../../../../api';
import {
  currentEffortChoice,
  effortBadgeView,
  formatEffortStrength,
  VOICE_EFFORT_CHOICES,
} from '../../voiceEffort';
import styles from './VoiceEffortBadge.module.scss';

export interface VoiceEffortBadgeProps {
  line: VoiceLinePreview;
  /** False while the game has tags switched off: the badge is dimmed and says so. */
  active: boolean;
  pending?: boolean;
  onChoose: (line: VoiceLinePreview, choice: VoiceEffortChoice) => void;
}

/**
 * The line's vocal-effort tag next to its similarity score, and the menu that
 * sets it by hand. A line without a tag shows only a quiet "+ tag".
 */
export const VoiceEffortBadge = ({
  line,
  active,
  pending = false,
  onChoose,
}: VoiceEffortBadgeProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const view = effortBadgeView(line);
  const chosen = currentEffortChoice(line);
  const autoTagLabel = t(`voice.effort.tag.${line.effortAutoTag ?? 'none'}`);

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    const left = Math.max(0, Math.min(rect.left, window.innerWidth - size.width));
    const below = rect.bottom + 4;
    const top = below + size.height > window.innerHeight ? rect.top - size.height - 4 : below;
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(0, top)}px`;
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const title = [
    view.kind === 'empty' ? t('voice.effort.addTitle') : null,
    line.effortStrength != null
      ? t('voice.effort.strength', { strength: formatEffortStrength(line.effortStrength) })
      : t('voice.effort.notMeasured'),
    line.effortOverride
      ? t('voice.effort.manual', { tag: autoTagLabel })
      : view.kind === 'tag'
        ? t('voice.effort.auto')
        : null,
    active ? null : t('voice.effort.off'),
  ]
    .filter(Boolean)
    .join(' · ');

  const label =
    view.kind === 'tag'
      ? t(`voice.effort.tag.${view.tag}`)
      : view.kind === 'removed'
        ? t('voice.effort.tag.none')
        : t('voice.effort.add');
  const tone =
    view.kind === 'tag'
      ? styles[view.tag]
      : view.kind === 'removed'
        ? styles.removed
        : styles.empty;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.badge} ${tone} ${active ? '' : styles.inactive} ${line.effortOverride ? styles.manual : ''}`}
        title={title}
        aria-label={`${t('voice.effort.menuLabel')}: ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className={styles.menu}
            role="menu"
            aria-label={t('voice.effort.menuLabel')}
          >
            {VOICE_EFFORT_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                role="menuitemradio"
                aria-checked={chosen === choice}
                className={`${styles.item} ${chosen === choice ? styles.itemChosen : ''}`}
                onClick={() => {
                  setOpen(false);
                  if (choice !== chosen) onChoose(line, choice);
                }}
              >
                {t(`voice.effort.choice.${choice}`, { tag: autoTagLabel })}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};
