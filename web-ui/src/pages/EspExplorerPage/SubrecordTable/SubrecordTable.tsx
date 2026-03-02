import { useTranslation } from 'react-i18next';
import type { EspRecordView } from '../../../api';
import s from './SubrecordTable.module.scss';

interface SubrecordTableProps {
  /** Parent record whose subrecords will be displayed in a detail table. */
  record: EspRecordView;
}

/** Renders the expandable subrecord detail table for one ESP record. */
export const SubrecordTable = ({ record }: SubrecordTableProps) => {
  const { t } = useTranslation();

  if (record.subrecords.length === 0) {
    return <p className={s.noSubrecords}>{t('espExplorer.noSubrecords')}</p>;
  }

  return (
    <table className={s.subTable}>
      <thead>
        <tr>
          <th className={s.thSubSig}>{t('espExplorer.colSubSig')}</th>
          <th className={s.thSubSize}>{t('espExplorer.colSubSize')}</th>
          <th className={s.thSubHex}>{t('espExplorer.colSubHex')}</th>
          <th className={s.thSubText}>{t('espExplorer.colSubText')}</th>
        </tr>
      </thead>
      <tbody>
        {record.subrecords.map((subrecord, index) => (
          <tr key={index} className={s.subRow}>
            <td className={s.tdSubSig}>{subrecord.sig}</td>
            <td className={s.tdSubSize}>{subrecord.size}</td>
            <td className={s.tdSubHex}>{subrecord.hexPreview}</td>
            <td className={s.tdSubText}>{subrecord.textHint ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
