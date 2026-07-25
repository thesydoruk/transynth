/**
 * QA check for grammatical gender agreement in Ukrainian dialog translations.
 *
 * The dialog import resolves who speaks each line and who they address, so a
 * translation that says «я була» for a male speaker can be caught mechanically.
 * The player character is the special case: their gender is picked at runtime,
 * so any committed form is wrong for half the players and the line has to be
 * rephrased impersonally instead.
 */
import { findUkrainianGenderConflicts, type UkGenderConflict } from '../../../dialog';
import { dialogParticipantsFromRow, type DialogParticipantsRow } from './dialogs/participants';
import type { QAIssueInput } from './qaHelpers';

/** Language whose morphology {@link findUkrainianGenderConflicts} understands. */
const SUPPORTED_TARGET_LANG = 'uk';

const ROLE_LABEL = { speaker: 'speaker', addressee: 'addressee' } as const;

const conflictMessage = (role: UkGenderConflict['role'], group: UkGenderConflict[]): string => {
  const forms = group.map((c) => `"${c.form}"`).join(', ');
  const found = group[0]!.found;
  if (group[0]!.expected === 'any') {
    return `Gender: ${forms} commits to ${found} gender, but the ${ROLE_LABEL[role]} is the player character, whose gender is chosen in game. Rephrase impersonally or use plural «ви».`;
  }
  return `Gender: ${forms} is ${found}, but the ${ROLE_LABEL[role]} is ${group[0]!.expected}.`;
};

/**
 * Append gender agreement issues for one translated dialog line.
 *
 * @param row - Participant columns from `dialogParticipantsLateralSql`; rows
 * outside the dialog graph carry nulls and produce no issues.
 * @param field - Subrecord the string came from, needed to tell the player
 * prompt half of an INFO record from the NPC reply.
 */
export const applyGenderQaIssues = (
  issues: QAIssueInput[],
  translation: string,
  targetLang: string,
  row: Partial<DialogParticipantsRow>,
  field: string | null | undefined,
): void => {
  if (targetLang !== SUPPORTED_TARGET_LANG) return;

  const participants = dialogParticipantsFromRow(row, field);
  const conflicts = findUkrainianGenderConflicts(translation, participants);
  if (conflicts.length === 0) return;

  for (const role of ['speaker', 'addressee'] as const) {
    const group = conflicts.filter((c) => c.role === role);
    if (group.length === 0) continue;
    issues.push({
      issueType: 'gender_mismatch',
      severity: group[0]!.expected === 'any' ? 'warning' : 'error',
      message: conflictMessage(role, group),
    });
  }
};
