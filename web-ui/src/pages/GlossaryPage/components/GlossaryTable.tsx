import { useTranslation } from 'react-i18next';
import type { GlossaryEntry } from '../../../api';
import s from '../GlossaryPage.module.scss';

type GlossaryTableProps = {
  entries: GlossaryEntry[];
  editId: number | null;
  editTerm: string;
  editTranslation: string;
  updatePending: boolean;
  removePending: boolean;
  onEditTermChange: (value: string) => void;
  onEditTranslationChange: (value: string) => void;
  onStartEdit: (entry: GlossaryEntry) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRemove: (id: number) => void;
};

export const GlossaryTable = ({
  entries,
  editId,
  editTerm,
  editTranslation,
  updatePending,
  removePending,
  onEditTermChange,
  onEditTranslationChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRemove,
}: GlossaryTableProps) => {
  const { t } = useTranslation();

  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th className={s.th}>{t('glossary.sourceTerm')}</th>
          <th className={s.th}>{t('glossary.translationCol')}</th>
          <th className={s.th}>{t('glossary.langs')}</th>
          <th className={s.th}>{t('glossary.sourceCol')}</th>
          <th className={s.th}></th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id} className={s.tr}>
            <td className={s.tdTerm}>
              {editId === entry.id ? (
                <input
                  className={s.inlineInput}
                  value={editTerm}
                  onChange={(e) => onEditTermChange(e.target.value)}
                />
              ) : (
                entry.term
              )}
            </td>
            <td className={entry.translation ? s.tdTranslFilled : s.tdTranslEmpty}>
              {editId === entry.id ? (
                <input
                  className={s.inlineInput}
                  value={editTranslation}
                  onChange={(e) => onEditTranslationChange(e.target.value)}
                  placeholder="—"
                />
              ) : (
                (entry.translation ?? '—')
              )}
            </td>
            <td className={s.tdLang}>
              <span className={s.langBadge}>
                {entry.src_lang}→{entry.tgt_lang}
              </span>
            </td>
            <td className={s.tdSource}>
              {entry.source === 'manual'
                ? t('glossary.sources.manual')
                : entry.source.startsWith('seed:')
                  ? t('glossary.sources.seed')
                  : entry.source}
            </td>
            <td className={`${s.td} ${s.rowActions}`}>
              {editId === entry.id ? (
                <>
                  <button
                    onClick={onSaveEdit}
                    disabled={updatePending || !editTerm.trim()}
                    className={s.btnRow}
                    title={t('glossary.saveTerm')}
                  >
                    {t('glossary.saveTerm')}
                  </button>
                  <button
                    onClick={onCancelEdit}
                    disabled={updatePending}
                    className={s.btnRowGhost}
                    title={t('glossary.cancelEdit')}
                  >
                    {t('glossary.cancelEdit')}
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => onStartEdit(entry)}
                    className={s.btnRowGhost}
                    title={t('glossary.editTerm')}
                  >
                    {t('glossary.editTerm')}
                  </button>
                  <button
                    onClick={() => onRemove(entry.id)}
                    disabled={removePending}
                    className={s.btnDelete}
                    title={t('glossary.deleteTerm')}
                  >
                    ✕
                  </button>
                </>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
