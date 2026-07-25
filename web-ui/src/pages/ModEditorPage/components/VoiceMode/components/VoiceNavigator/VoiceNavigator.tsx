import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { VoiceSpeakerGroup } from '../../../../../../api';
import { VoiceSpeakerRow } from './VoiceSpeakerRow';
import styles from './VoiceNavigator.module.scss';

const ROW_HEIGHT = 52;

export interface VoiceNavigatorProps {
  speakers: VoiceSpeakerGroup[];
  totalCount: number;
  activeKey: string | null;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (key: string) => void;
  onStepSpeaker: (delta: number) => void;
  isLoading: boolean;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/** Left column: speaker search and virtualized list. */
export const VoiceNavigator = ({
  speakers,
  totalCount,
  activeKey,
  search,
  onSearchChange,
  onSelect,
  onStepSpeaker,
  isLoading,
  searchRef,
}: VoiceNavigatorProps) => {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: speakers.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const activeIndex = speakers.findIndex((speaker) => speaker.key === activeKey);

  useEffect(() => {
    if (activeIndex >= 0) virtualizer.scrollToIndex(activeIndex, { align: 'auto' });
  }, [activeIndex, virtualizer]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      onStepSpeaker(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      searchRef.current?.blur();
    }
  };

  return (
    <aside className={styles.navigator}>
      <div className={styles.header}>
        <p className={styles.title}>{t('modEditor.voiceSpeakers')}</p>
      </div>

      <div className={styles.controls}>
        <input
          ref={searchRef}
          className={styles.search}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('voice.searchPlaceholder')}
          aria-label={t('voice.searchPlaceholder')}
        />
      </div>

      <div ref={scrollRef} className={styles.list}>
        {isLoading ? (
          <p className={styles.note}>{t('modEditor.voiceLoading')}</p>
        ) : speakers.length === 0 ? (
          <p className={styles.note}>
            {totalCount === 0 ? t('modEditor.voiceNoLines') : t('voice.noMatches')}
          </p>
        ) : (
          <div className={styles.viewport} style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={speakers[item.index].key}
                className={styles.rowSlot}
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <VoiceSpeakerRow
                  speaker={speakers[item.index]}
                  active={speakers[item.index].key === activeKey}
                  onSelect={onSelect}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        {t('voice.speakerCount', { shown: speakers.length, total: totalCount })}
      </footer>
    </aside>
  );
};
