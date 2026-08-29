import type { TFunction } from 'i18next';
import type { StringRow } from '../../../../api';

export const isPlayerPromptRow = (row: StringRow): boolean =>
  row.signature === 'INFO' && (row.path?.split('\\').pop() ?? '') === 'RNAM';

export const genderBadgeTitle = (row: StringRow, t: TFunction): string | undefined => {
  const name = row.line_speaker_name?.trim();
  if (!name) return undefined;
  const gender = row.line_gender ?? 'unknown';
  const genderLabel = t(`dialogs.gender.${gender === 'neutral' ? 'neutral' : gender}`, {
    defaultValue: gender,
  });
  if (isPlayerPromptRow(row)) {
    const addresseeGender = row.line_addressee_gender ?? 'unknown';
    const addresseeGenderLabel = t(`dialogs.gender.${addresseeGender}`, {
      defaultValue: addresseeGender,
    });
    return t('dialogs.gender.addresseeTitle', { name, gender: addresseeGenderLabel });
  }
  return t('modEditor.genderLineTooltip', { name, gender: genderLabel });
};
