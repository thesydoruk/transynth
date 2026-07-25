import { applyGenderQaIssues } from '../queries/qaGender';

type Issue = { issueType: string; severity: 'warning' | 'error'; message: string };

/** Collect the issues the check appends for one line. */
const run = (
  translation: string,
  row: {
    speaker_gender?: string | null;
    addressee_kind?: string | null;
    addressee_gender?: string | null;
  },
  field: string | null = 'NAM1',
  targetLang = 'uk',
) => {
  const issues: Issue[] = [];
  applyGenderQaIssues(issues, translation, targetLang, row, field);
  return issues;
};

describe('applyGenderQaIssues', () => {
  it('reports a feminine form spoken by a male NPC as an error', () => {
    const issues = run('Я була тут учора.', { speaker_gender: 'male' });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issueType).toBe('gender_mismatch');
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.message).toContain('"була"');
  });

  it('passes a form that agrees with the speaker', () => {
    expect(run('Я була тут учора.', { speaker_gender: 'female' })).toEqual([]);
  });

  it('warns instead of erroring when the participant is the player', () => {
    const issues = run('Ти готовий?', {
      speaker_gender: 'female',
      addressee_kind: 'player',
      addressee_gender: 'any',
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message).toContain('player character');
  });

  it('treats the RNAM half of an INFO record as spoken by the player', () => {
    const issues = run('Я був готовий до цього.', { speaker_gender: 'male' }, 'RNAM');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
  });

  it('stays silent for rows outside the dialog graph', () => {
    expect(run('Я була тут учора.', {})).toEqual([]);
  });

  it('stays silent for target languages it cannot analyse', () => {
    expect(run('Я була тут учора.', { speaker_gender: 'male' }, 'NAM1', 'pl')).toEqual([]);
  });

  it('groups several conflicting forms of one participant into a single issue', () => {
    const issues = run('Я була там і я бачила все.', { speaker_gender: 'male' });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('"була"');
    expect(issues[0]!.message).toContain('"бачила"');
  });
});
