import { useTranslation } from 'react-i18next';
import { type SceneDialogLine } from '../../../../../../api';
import { DialogLineEditor } from '../DialogLineEditor';
import styles from './SceneConversationView.module.scss';

interface SceneLineCardProps {
  line: SceneDialogLine;
  targetLang: string;
  queryKey: unknown[];
}

/**
 * Deterministic HSL hue from a string identifier — same algorithm as
 * {@link DialogNodeCard}'s `speakerHue` to keep colors consistent.
 */
const speakerHue = (id: string): number => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
};

/**
 * A single conversation turn within a scene.
 *
 * A scene phase points at a dialog topic, which may offer several conditioned
 * INFOs; each of them becomes its own card labelled with its variant number.
 */
export const SceneLineCard = ({ line, targetLang, queryKey }: SceneLineCardProps) => {
  const { t } = useTranslation();

  /* Speaker identification:
     - Use speaker_name from the DB (ANAM or voice file lookup)
     - Fall back to alias_id label: -2 → "Player", >= 0 → "Alias N" */
  const speakerLabel =
    line.speaker_name ??
    (line.alias_id === -2
      ? t('dialogs.playerAlias')
      : t('dialogs.aliasLabel', { id: line.alias_id }));

  /* Color key: use speaker_name for consistency with DialogNodeCard, else alias_id string */
  const colorKey = line.speaker_name ?? String(line.alias_id);
  const cardStyle = { '--speaker-hue': speakerHue(colorKey) } as React.CSSProperties;

  return (
    <article className={styles.lineCard} style={cardStyle}>
      <header className={styles.lineHead}>
        <span className={styles.speaker} title={line.topic_formid_hex}>
          {speakerLabel}
        </span>
        {line.info_formid_hex && (
          <span className={styles.formid} title={t('dialogs.infoFormIdTitle')}>
            {line.info_formid_hex}
          </span>
        )}
        {line.variant_count > 1 && (
          <span className={styles.variantBadge} title={t('dialogs.variantTitle')}>
            {t('dialogs.variantBadge', {
              index: line.variant_index,
              count: line.variant_count,
            })}
          </span>
        )}
      </header>

      {line.lines.length === 0 ? (
        <div className={styles.source}>
          <em className={styles.noString}>{t('dialogs.noSourceString')}</em>
        </div>
      ) : (
        line.lines.map((dialogLine) => (
          <DialogLineEditor
            key={dialogLine.string_id}
            line={dialogLine}
            targetLang={targetLang}
            queryKey={queryKey}
          />
        ))
      )}
    </article>
  );
};
