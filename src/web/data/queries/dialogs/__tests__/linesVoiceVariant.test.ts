import { remapDialogLineVoiceVariants, type DialogLine } from '../lines';

const line = (variant: number): DialogLine => ({
  kind: 'response',
  string_id: variant,
  source: `s${variant}`,
  context: null,
  translation_id: null,
  translation: null,
  status: null,
  confidence: null,
  provenance: null,
  model: null,
  updated_at: null,
  qa_issue_count: 0,
  voice_variant: variant,
});

describe('remapDialogLineVoiceVariants', () => {
  it('rewrites voice_variant using TRDA response numbers', () => {
    const map = new Map([['00052062', [2]]]);
    const remapped = remapDialogLineVoiceVariants('00052062', [line(1)], map);
    expect(remapped[0]?.voice_variant).toBe(2);
  });

  it('fixes swapped multi-response order', () => {
    const map = new Map([['00023BBB', [2, 1]]]);
    const remapped = remapDialogLineVoiceVariants('00023BBB', [line(1), line(2)], map);
    expect(remapped.map((l) => l.voice_variant)).toEqual([2, 1]);
  });

  it('leaves prompts and unknown INFOs unchanged', () => {
    const map = new Map([['00052062', [2]]]);
    const prompt: DialogLine = { ...line(1), kind: 'prompt', voice_variant: null };
    expect(remapDialogLineVoiceVariants('00052062', [prompt], map)[0]).toBe(prompt);
    expect(remapDialogLineVoiceVariants('00000001', [line(1)], map)[0]?.voice_variant).toBe(1);
  });
});
