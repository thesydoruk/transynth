import styles from './ProgressPill.module.scss';

export interface ProgressPillProps {
  /** Lines already translated. */
  done: number;
  /** Lines in total; a zero total renders an inert empty bar. */
  total: number;
  /** Render the `done / total` counter next to the bar. */
  showCount?: boolean;
  title?: string;
}

/** Slim translation-progress bar shared by the navigator and the transcript header. */
export const ProgressPill = ({ done, total, showCount = false, title }: ProgressPillProps) => {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  const complete = total > 0 && done >= total;

  return (
    <span className={styles.pill} title={title ?? `${done} / ${total}`}>
      <span className={styles.track}>
        <span
          className={`${styles.fill} ${complete ? styles.complete : ''}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      {showCount && (
        <span className={styles.count}>
          {done}/{total}
        </span>
      )}
    </span>
  );
};
