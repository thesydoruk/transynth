import { useTranslation } from 'react-i18next';
import type { DialogEntry } from '../../../../../../api';
import type { TranscriptTreeGuide } from '../../transcriptTree';
import { speakerStyle } from '../../speakerColor';
import { DialogLineRow } from '../DialogLineRow';
import { SpeakerGenderBadge } from './SpeakerGenderBadge';
import type { DialogLineHandlers } from './transcriptTypes';
import styles from './DialogTranscriptView.module.scss';

export interface DialogEntryCardProps {
  entry: DialogEntry;
  guide: TranscriptTreeGuide;
  hasChildren: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  handlers: DialogLineHandlers;
}

/**
 * One speaker turn: who talks, which INFO record it came from, and every
 * translatable line the record holds.
 */
export const DialogEntryCard = ({
  entry,
  guide,
  hasChildren,
  collapsed,
  onToggleCollapse,
  handlers,
}: DialogEntryCardProps) => {
  const { t } = useTranslation();

  const speaker =
    entry.speaker ??
    (entry.alias_id === null
      ? t('dialogs.unknownSpeaker')
      : entry.alias_id === -2
        ? t('dialogs.playerAlias')
        : t('dialogs.aliasLabel', { id: entry.alias_id }));

  const addresseeName =
    entry.addressee ?? (entry.addressee_kind === 'player' ? t('dialogs.playerAlias') : null);
  const addresseeGender = entry.addressee_kind === 'player' ? 'any' : entry.addressee_gender;

  const colorKey = entry.speaker ?? (entry.alias_id === null ? null : `alias-${entry.alias_id}`);
  const speakerRecord = entry.speaker_key
    ? handlers.speakers.byKey.get(entry.speaker_key)
    : undefined;

  return (
    <>
      {entry.section && (
        <h3 className={styles.section}>{t('dialogs.sceneMarker', { label: entry.section })}</h3>
      )}
      <div className={styles.entryWrap}>
        {entry.depth > 0 && (
          <div className={styles.gutter} aria-hidden>
            {guide.rails.map((continues, col) => (
              <span key={col} className={continues ? styles.rail : styles.gutterGap} />
            ))}
            <span className={guide.isLast ? styles.elbow : styles.tee} />
          </div>
        )}
        <article className={styles.entry} style={speakerStyle(colorKey)}>
          <header className={styles.entryHead}>
            {hasChildren && (
              <button
                type="button"
                className={styles.branchToggle}
                aria-expanded={!collapsed}
                title={
                  collapsed ? t('dialogs.tree.expandBranch') : t('dialogs.tree.collapseBranch')
                }
                onClick={onToggleCollapse}
              >
                {collapsed ? '▸' : '▾'}
              </button>
            )}
            <span className={styles.speaker}>{speaker}</span>
            <SpeakerGenderBadge
              gender={entry.speaker_gender}
              override={speakerRecord?.gender_override ?? null}
              speakerKey={entry.speaker_key}
              saving={
                entry.speaker_key !== null && handlers.speakers.pendingKeys.has(entry.speaker_key)
              }
              onChange={handlers.speakers.setGender}
            />
            {addresseeName && (
              <span
                className={styles.addressee}
                title={t('dialogs.gender.addresseeTitle', {
                  name: addresseeName,
                  gender: t(`dialogs.gender.${addresseeGender}`),
                })}
              >
                {t('dialogs.gender.addressee', { name: addresseeName })}
              </span>
            )}
            {entry.depth > 0 && (
              <span className={styles.branchTag} title={t('dialogs.branchTitle')}>
                {t('dialogs.branchTag', { depth: entry.depth })}
              </span>
            )}
            {entry.variant_count > 1 && (
              <span className={styles.variantTag} title={t('dialogs.variantTitle')}>
                {t('dialogs.variantBadge', {
                  index: entry.variant_index,
                  count: entry.variant_count,
                })}
              </span>
            )}
            {entry.info_formid_hex && (
              <span className={styles.formid} title={t('dialogs.infoFormIdTitle')}>
                {entry.info_formid_hex}
              </span>
            )}
          </header>

          {entry.lines.length === 0 ? (
            <p className={styles.noSource}>{t('dialogs.noSourceString')}</p>
          ) : (
            entry.lines.map((line) => (
              <DialogLineRow
                key={line.string_id}
                line={line}
                focused={handlers.focusedId === line.string_id}
                editing={handlers.editingId === line.string_id}
                saving={handlers.pendingIds.has(line.string_id)}
                onFocus={() => handlers.onFocus(line)}
                onEdit={() => handlers.onEdit(line)}
                onCancel={handlers.onCancel}
                onCommit={(text, advance) => handlers.onCommit(line, text, advance)}
                onSetStatus={(status) => handlers.onSetStatus(line, status)}
                voice={handlers.voiceFor(entry, line)}
                targetLang={handlers.targetLang}
              />
            ))
          )}
        </article>
      </div>
    </>
  );
};
