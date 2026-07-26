import { effectiveNarratorGenderSql } from '../../../dialog/narratorGender';
import { effectiveSpeakerGenderSql } from '../../../dialog/gender';
import { DIALOG_PROMPT_PATH } from './dialogs/lines';

/** Lateral body resolving gender for an NPC_ record via dialog_speakers. */
export const npcSpeakerLateralSql = (recordsAlias: string): string => `
    SELECT sp.display_name,
           ${effectiveSpeakerGenderSql('sp')} AS speaker_gender
      FROM dialog_speakers sp
     WHERE ${recordsAlias}.signature = 'NPC_'
       AND sp.mod_id = ${recordsAlias}.mod_id
       AND sp.speaker_key = 'npc:' || upper(${recordsAlias}.formid_hex)
     LIMIT 1`;

/** SQL expression for the gender icon column in the string grid. */
export const stringLineGenderSql = (
  recordsAlias: string,
  dpAlias: string,
  npcAlias: string,
): string => `
  CASE
    WHEN ${recordsAlias}.signature = 'INFO'
     AND ${recordsAlias}.path_simplified = '${DIALOG_PROMPT_PATH}' THEN 'any'
    WHEN ${recordsAlias}.signature = 'INFO' THEN
      COALESCE(NULLIF(${dpAlias}.speaker_gender, ''), 'unknown')
    WHEN ${recordsAlias}.signature = 'NPC_' THEN
      COALESCE(NULLIF(${npcAlias}.speaker_gender, ''), 'unknown')
    ELSE ${effectiveNarratorGenderSql(recordsAlias)}
  END`;

/** Primary speaker / NPC name for the gender column tooltip. */
export const stringLineSpeakerNameSql = (
  recordsAlias: string,
  dpAlias: string,
  npcAlias: string,
): string => `
  CASE
    WHEN ${recordsAlias}.signature = 'INFO'
     AND ${recordsAlias}.path_simplified = '${DIALOG_PROMPT_PATH}' THEN
      NULLIF(${dpAlias}.addressee_name, '')
    WHEN ${recordsAlias}.signature = 'INFO' THEN NULLIF(${dpAlias}.speaker_name, '')
    WHEN ${recordsAlias}.signature = 'NPC_' THEN
      COALESCE(NULLIF(${npcAlias}.display_name, ''), NULLIF(${recordsAlias}.edid, ''))
    ELSE NULL
  END`;

export { effectiveNarratorGenderSql, effectiveSpeakerGenderSql };
