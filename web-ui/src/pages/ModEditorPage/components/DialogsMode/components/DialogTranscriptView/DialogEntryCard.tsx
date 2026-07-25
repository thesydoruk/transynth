import { useTranslation } from 'react-i18next';
import type { DialogEntry } from '../../../../../../api';
import { speakerStyle } from '../../speakerColor';
import { DialogLineRow } from '../DialogLineRow';
import { SpeakerGenderBadge } from './SpeakerGenderBadge';
import type { DialogLineHandlers } from './transcriptTypes';
import styles from './DialogTranscriptView.module.scss';

/** Indent stops after this depth so deep branches stay readable. */
const MAX_INDENT_DEPTH = 6;
const INDENT_STEP = 22;

export interface DialogEntryCardProps {
  entry: DialogEntry;
  handlers: DialogLineHandlers;
}

/**
 * One speaker turn: who talks, which INFO record it came from, and every
 * translatable line the record holds.
 */
export const DialogEntryCard = ({ entry, handlers }: DialogEntryCardProps) => {
  const { t } = useTranslation();

  const speaker =
    entry.speaker ??
    (entry.alias_id === null
      ? t('dialogs.unknownSpeaker')
      : entry.alias_id === -2
        ? t('dialogs.playerAlias')
        : t('dialogs.aliasLabel', { id: entry.alias_id }));

  const indent = Math.min(entry.depth, MAX_INDENT_DEPTH) * INDENT_STEP;
  const colorKey = entry.speaker ?? (entry.alias_id === null ? null : `alias-${entry.alias_id}`);
  const speakerRecord = entry.speaker_key
    ? handlers.speakers.byKey.get(entry.speaker_key)
    : undefined;

  return (
    <>
      {entry.section && (
        <h3 className={styles.section}>{t('dialogs.sceneMarker', { label: entry.section })}</h3>
      )}
      <article className={styles.entry} style={{ marginLeft: indent, ...speakerStyle(colorKey) }}>
        <header className={styles.entryHead}>
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
          {entry.addressee && (
            <span
              className={styles.addressee}
              title={t('dialogs.gender.addresseeTitle', {
                name: entry.addressee,
                gender: t(`dialogs.gender.${entry.addressee_gender}`),
              })}
            >
              {t('dialogs.gender.addressee', { name: entry.addressee })}
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
            />
          ))
        )}
      </article>
    </>
  );
};
