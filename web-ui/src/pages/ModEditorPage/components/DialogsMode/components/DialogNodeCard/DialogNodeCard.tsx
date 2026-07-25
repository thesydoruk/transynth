import { useTranslation } from 'react-i18next';
import { type DialogTreeNode } from '../../../../../../api';
import { DialogLineEditor } from '../DialogLineEditor';
import styles from './DialogNodeCard.module.scss';

/** Props for a single dialog node card. */
export interface DialogNodeCardProps {
  /** The dialog node data from the API. */
  node: DialogTreeNode;
  /** Target language code — used when saving a translation. */
  targetLang: string;
  /** React Query key array to invalidate after save. */
  queryKey: unknown[];
}

/**
 * Deterministic HSL color derived from a string identifier.
 * Used to assign a consistent left-border tint per speaker.
 */
const speakerHue = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
};

/**
 * A card representing one INFO record inside a DIAL topic tree.
 *
 * Shows the speaker plus every translatable line of the record: the player
 * prompt when the INFO has one, followed by its spoken responses.
 */
export const DialogNodeCard = ({ node, targetLang, queryKey }: DialogNodeCardProps) => {
  const { t } = useTranslation();

  const hue = node.speaker_formid_hex ? speakerHue(node.speaker_formid_hex) : null;
  const cardStyle = hue !== null ? ({ '--speaker-hue': hue } as React.CSSProperties) : undefined;

  return (
    <article
      className={`${styles.card} ${hue !== null ? styles.hasSpeaker : ''}`}
      style={cardStyle}
    >
      <header className={styles.cardHead}>
        {node.speaker_name && (
          <span className={styles.speaker} title={node.speaker_formid_hex ?? undefined}>
            {node.speaker_name}
          </span>
        )}
        <span className={styles.formid} title={t('dialogs.infoFormIdTitle')}>
          {node.info_formid_hex}
        </span>
      </header>

      {node.lines.length === 0 ? (
        <div className={styles.source}>
          <em className={styles.noString}>{t('dialogs.noSourceString')}</em>
        </div>
      ) : (
        node.lines.map((line) => (
          <DialogLineEditor
            key={line.string_id}
            line={line}
            targetLang={targetLang}
            queryKey={queryKey}
          />
        ))
      )}
    </article>
  );
};
