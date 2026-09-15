import { effectiveNarratorGenderSql } from '../../../dialog/narratorGender';

/**
 * The string grid's speaker column.
 *
 * Which rows have a voice, and whose, is each game's answer — a Creation Engine
 * plugin counts both halves of an INFO exchange and an `NPC_` record's own
 * name, a Disco `.po` row the speaker of its clip — so the lookup comes from
 * the plugin (`dialog.lineSpeakerSql`) and this file only decides the fallback:
 * a row no game claims shows the record's narrator gender instead.
 */

/** Gender shown in the grid, for a row joined to {@link lineSpeakerLateralSql}. */
export const stringLineGenderSql = (recordsAlias: string, speakerAlias: string): string => `
  COALESCE(NULLIF(${speakerAlias}.gender, ''), ${effectiveNarratorGenderSql(recordsAlias)})`;

/** Speaker name for the gender column tooltip; null when nobody speaks the row. */
export const stringLineSpeakerNameSql = (speakerAlias: string): string =>
  `NULLIF(${speakerAlias}.display_name, '')`;
