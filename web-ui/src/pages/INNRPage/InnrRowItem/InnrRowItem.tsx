import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { InnrRow } from '../../../api';
import { StatusBadge } from '../../../components/StatusBadge';
import { slotSuffix } from '../slotSuffix';
import s from './InnrRowItem.module.scss';

interface InnrRowItemProps {
  row: InnrRow;
  onSave: (stringId: number, text: string) => void;
  onClear: (stringId: number) => void;
  isSaving: boolean;
}

/** Single editable INNR component row with save and clear actions. */
export const InnrRowItem = ({ row, onSave, onClear, isSaving }: InnrRowItemProps) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(row.translation ?? '');
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saved'>('idle');
  const isDirty = value !== (row.translation ?? '');

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
    setSaveState('dirty');
  };

  const handleSave = useCallback(() => {
    if (!isDirty || !value.trim()) return;
    onSave(row.string_id, value.trim());
    setSaveState('saved');
    setTimeout(() => setSaveState('idle'), 1500);
  }, [isDirty, onSave, row.string_id, value]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSave();
    } else if (event.key === 'Escape') {
      setValue(row.translation ?? '');
      setSaveState('idle');
    }
  };

  const slot = slotSuffix(row.edid);

  return (
    <tr className={s.tr}>
      <td className={s.td}>{slot !== null && <span className={s.slotBadge}>{slot}</span>}</td>
      <td className={s.td}><span className={s.formid}>{row.formid_hex}</span></td>
      <td className={s.td}><span className={s.srcText} title={row.source}>{row.source}</span></td>
      <td className={s.td}>
        <input
          className={[
            s.translInput,
            saveState === 'dirty' ? s.dirty : '',
            saveState === 'saved' ? s.saved : '',
          ].filter(Boolean).join(' ')}
          type="text"
          value={value}
          onChange={handleChange}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          placeholder={t('innr.translPlaceholder')}
          disabled={isSaving}
          aria-label={t('innr.translLabel', { source: row.source })}
        />
      </td>
      <td className={s.td}>{row.status && <StatusBadge status={row.status} small />}</td>
      <td className={s.td}>
        {row.qa_issue_count > 0 && (
          <span className={s.qaBadge} title={t('innr.qaIssues', { count: row.qa_issue_count })}>
            {row.qa_issue_count}
          </span>
        )}
      </td>
      <td className={s.td}>
        <div className={s.actions}>
          <button className={s.saveBtn} disabled={!isDirty || isSaving} onClick={handleSave} title={t('innr.save')}>
            {t('innr.save')}
          </button>
          {row.translation !== null && (
            <button className={s.clearBtn} disabled={isSaving} onClick={() => onClear(row.string_id)} title={t('innr.clear')}>
              ✕
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};
