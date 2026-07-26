import { effectiveNarratorGenderSql } from '../../../dialog/narratorGender';
import { effectiveSpeakerGenderSql } from '../../../dialog/gender';
import { DIALOG_PROMPT_PATH } from './dialogs/lines';

/** SQL expression for the gender icon column in the string grid. */
export const stringLineGenderSql = (recordsAlias: string, dpAlias: string): string => `
  CASE
    WHEN ${recordsAlias}.signature = 'INFO'
     AND ${recordsAlias}.path_simplified = '${DIALOG_PROMPT_PATH}' THEN 'any'
    WHEN ${recordsAlias}.signature = 'INFO' THEN
      COALESCE(NULLIF(${dpAlias}.speaker_gender, ''), 'unknown')
    ELSE ${effectiveNarratorGenderSql(recordsAlias)}
  END`;

export { effectiveNarratorGenderSql, effectiveSpeakerGenderSql };
