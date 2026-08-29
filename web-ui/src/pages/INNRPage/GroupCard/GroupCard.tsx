import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { InnrGroup } from '../../../api';
import { InnrRowItem } from '../InnrRowItem';
import s from './GroupCard.module.scss';

interface GroupCardProps {
  group: InnrGroup;
  defaultOpen: boolean;
  onSave: (stringId: number, text: string) => void;
  onClear: (stringId: number) => void;
  isSaving: boolean;
}

/** Collapsible card that groups INNR component rows by their base EDID. */
export const GroupCard = ({ group, defaultOpen, onSave, onClear, isSaving }: GroupCardProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  const translated = group.rows.filter((row) => row.translation !== null).length;
  const total = group.rows.length;
  const allDone = translated === total;

  return (
    <div className={s.group}>
      <button
        type="button"
        className={s.groupHeader}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className={`${s.chevron} ${open ? s.open : ''}`} aria-hidden="true">
          ▶
        </span>
        <span className={s.baseEdid}>{group.base_edid || '—'}</span>
        <span className={s.groupCount}>{total}</span>
        <span className={`${s.groupProgress} ${allDone ? s.progressDone : ''}`}>
          {translated}/{total}
        </span>
      </button>

      {open && (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th className={s.th}>{t('innr.colSlot')}</th>
                <th className={s.th}>{t('innr.colFormId')}</th>
                <th className={s.th}>{t('innr.colSource')}</th>
                <th className={s.th}>{t('innr.colTranslation')}</th>
                <th className={s.th}>{t('innr.colStatus')}</th>
                <th className={s.th}>{t('innr.colQA')}</th>
                <th className={s.th}>{t('innr.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => (
                <InnrRowItem
                  key={row.string_id}
                  row={row}
                  onSave={onSave}
                  onClear={onClear}
                  isSaving={isSaving}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
