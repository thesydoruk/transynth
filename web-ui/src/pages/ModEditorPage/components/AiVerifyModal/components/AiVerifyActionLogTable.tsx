import { useTranslation } from 'react-i18next';
import type { LlmVerifyActionLogEntry } from '../../../../../api';
import s from '../AiVerifyModal.module.scss';

const actionLabelKey = {
  approved: 'modEditor.aiVerifyActionApproved',
  fixed: 'modEditor.aiVerifyActionFixed',
  issue: 'modEditor.aiVerifyActionIssue',
} as const;

type AiVerifyActionLogTableProps = {
  actionLog: LlmVerifyActionLogEntry[];
  isRunning: boolean;
  srcLang: string;
  onRowClick?: (stringId: number) => void;
};

export const AiVerifyActionLogTable = ({
  actionLog,
  isRunning,
  srcLang,
  onRowClick,
}: AiVerifyActionLogTableProps) => {
  const { t } = useTranslation();

  const renderActionRow = (entry: LlmVerifyActionLogEntry, index: number) => (
    <tr
      key={`${entry.stringId}-${entry.action}-${index}`}
      className={onRowClick ? s.clickable : undefined}
      onClick={onRowClick ? () => onRowClick(entry.stringId) : undefined}
    >
      <td>
        <span
          className={
            entry.action === 'approved'
              ? s.actionApproved
              : entry.action === 'fixed'
                ? s.actionFixed
                : s.actionIssue
          }
        >
          {t(actionLabelKey[entry.action as keyof typeof actionLabelKey])}
        </span>
      </td>
      <td className={s.mono}>{entry.edid ?? '—'}</td>
      <td className={s.mono}>{entry.path ?? entry.signature ?? '—'}</td>
      <td className={s.textCell}>{entry.source}</td>
      <td className={s.reasonCell}>{entry.detail ?? '—'}</td>
    </tr>
  );

  return (
    <table className={s.table}>
      <thead>
        <tr>
          <th>{t('modEditor.aiVerifyAction')}</th>
          <th>{t('modEditor.edid')}</th>
          <th>{t('modEditor.field')}</th>
          <th>{t('modEditor.sourceText', { lang: srcLang.toUpperCase() })}</th>
          <th>{t('modEditor.aiVerifyActionDetail')}</th>
        </tr>
      </thead>
      <tbody>
        {actionLog.length === 0 ? (
          <tr>
            <td colSpan={5} className={s.empty}>
              {isRunning ? t('modEditor.aiVerifyLogScanning') : t('modEditor.aiVerifyLogEmpty')}
            </td>
          </tr>
        ) : (
          actionLog.map(renderActionRow)
        )}
      </tbody>
    </table>
  );
};
