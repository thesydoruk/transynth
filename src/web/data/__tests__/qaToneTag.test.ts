import { applyToneTagQaIssues } from '../queries/qaToneTag';

type Issue = { issueType: string; severity: 'warning' | 'error'; message: string };

/** Collect the issues the check appends for one line. */
const run = (
  source: string,
  translation: string,
  field: string | null = 'RNAM',
  targetLang = 'uk',
  game = 'fo4',
) => {
  const issues: Issue[] = [];
  applyToneTagQaIssues(issues, source, translation, targetLang, field, game);
  return issues;
};

describe('applyToneTagQaIssues', () => {
  it('warns when a tone prompt is translated as a bare word', () => {
    const issues = run('Sarcastic', 'Сарказм');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.issueType).toBe('tone_tag');
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message).toContain('"Sarcastic"');
  });

  it('catches the gendered adjective machine translation tends to write', () => {
    expect(run('Impatient', 'Нетерплячий')).toHaveLength(1);
  });

  it('accepts the bracketed remark', () => {
    expect(run('Sarcastic', '[Сарказм]')).toEqual([]);
    expect(run('Annoyed.', ' [Роздратовано] ')).toEqual([]);
  });

  it('leaves alone words reviewers wrote both ways, and ordinary answers', () => {
    expect(run('Unsure', 'Ще не ясно')).toEqual([]);
    expect(run('Yes', 'Так')).toEqual([]);
  });

  it('only checks the player prompt, in Ukrainian, of a game that has tone prompts', () => {
    expect(run('Sarcastic', 'Сарказм', 'NAM1')).toEqual([]);
    expect(run('Sarcastic', 'Sarkasmus', 'RNAM', 'de')).toEqual([]);
    expect(run('Sarcastic', 'Сарказм', 'RNAM', 'uk', 'sse')).toEqual([]);
  });
});
