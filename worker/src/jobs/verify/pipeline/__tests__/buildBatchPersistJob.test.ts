import { describe, it, expect } from '@jest/globals';
import {
  isBlockingVerifyResult,
  type LlmVerifyItemResult,
} from '../../../../../../src/llm/verifyTranslate';
import { buildBatchPersistJob } from '../buildBatchPersistJob';
import type { VerifyStringRow } from '../types';

const row = (over: Partial<VerifyStringRow> = {}): VerifyStringRow => ({
  string_id: 1,
  source: 'Are you ready?',
  translation: 'Ти готовий?',
  text_norm: null,
  text_norm_nopunct: null,
  signature: 'INFO',
  path: 'INFO\\NAM1',
  edid: 'TestLine',
  context: null,
  narrator_gender: null,
  narrator_gender_source: null,
  narrator_gender_override: null,
  rewrite_count: 0,
  prior_texts: [],
  speaker_key: 'npc:00000001',
  speaker_name: 'Piper',
  speaker_gender: 'female',
  speaker_is_player: false,
  addressee_kind: 'player',
  addressee_name: null,
  addressee_gender: 'any',
  ...over,
});

const result = (over: Partial<LlmVerifyItemResult> = {}): LlmVerifyItemResult => ({
  id: 1,
  verdict: 'suspicious',
  reason: 'Калька з англійської.',
  confidence: 0.9,
  suggestion: null,
  ...over,
});

const opts = { modId: 7, game: 'fo4', fixSuspicious: false, dryRun: false };

const build = (results: LlmVerifyItemResult[], fixSuspicious = false, dryRun = false) =>
  buildBatchPersistJob([row()], results, opts, fixSuspicious, dryRun);

describe('isBlockingVerifyResult', () => {
  it('blocks on incorrect', () => {
    expect(isBlockingVerifyResult(result({ verdict: 'incorrect' }))).toBe(true);
  });

  it('blocks on suspicious backed by a proven defect', () => {
    expect(isBlockingVerifyResult(result({ defects: ['gender_leak'] }))).toBe(true);
  });

  it('does not block on suspicious the model alone raised', () => {
    expect(isBlockingVerifyResult(result())).toBe(false);
    expect(isBlockingVerifyResult(result({ defects: [] }))).toBe(false);
  });

  it('does not block on ok', () => {
    expect(isBlockingVerifyResult(result({ verdict: 'ok' }))).toBe(false);
  });
});

describe('buildBatchPersistJob advisory routing', () => {
  it('records the objection and lets an unproven suspicious row go to review', () => {
    const job = build([result()]);
    expect(job.okStringIds).toEqual([1]);
    expect(job.advisories).toEqual([{ stringId: 1, message: 'Калька з англійської.' }]);
    expect(job.issues[0]?.advisory).toBe(true);
  });

  it('holds back a suspicious row a deterministic check backs', () => {
    const job = build([result({ defects: ['protected_token_mismatch'] })]);
    expect(job.okStringIds).toEqual([]);
    expect(job.advisories).toEqual([]);
    expect(job.issues[0]?.advisory).toBe(false);
  });

  it('holds back an incorrect row', () => {
    const job = build([result({ verdict: 'incorrect' })]);
    expect(job.okStringIds).toEqual([]);
    expect(job.advisories).toEqual([]);
  });

  it('does not approve a row whose text it is about to rewrite', () => {
    const job = build([result({ suggestion: 'Ну що, рушаємо?' })], true);
    expect(job.fixes.map((fix) => fix.stringId)).toEqual([1]);
    expect(job.okStringIds).toEqual([]);
    expect(job.advisories).toEqual([]);
  });

  it('still records the objection on a dry run, approving nothing new', () => {
    const job = build([result({ suggestion: 'Ну що, рушаємо?' })], true, true);
    expect(job.fixes).toEqual([]);
    expect(job.advisories).toEqual([]);
  });

  it('does not re-apply a wording this row already had', () => {
    const job = buildBatchPersistJob(
      [row({ prior_texts: ['Ну що,  рушаємо?'] })],
      [result({ suggestion: 'Ну що, рушаємо?' })],
      opts,
      true,
      false,
    );
    expect(job.fixes).toEqual([]);
    expect(job.advisories.map((a) => a.stringId)).toEqual([1]);
    expect(job.okStringIds).toEqual([1]);
  });

  it('stops rewriting an advisory row once its budget is spent', () => {
    const job = buildBatchPersistJob(
      [row({ rewrite_count: 5 })],
      [result({ suggestion: 'Ну що, рушаємо?' })],
      opts,
      true,
      false,
    );
    expect(job.fixes).toEqual([]);
    expect(job.advisories.map((a) => a.stringId)).toEqual([1]);
  });

  it('still repairs a proven defect after the budget is spent', () => {
    const job = buildBatchPersistJob(
      [row({ rewrite_count: 99 })],
      [result({ suggestion: 'Ну що, рушаємо?', defects: ['gender_leak'] })],
      opts,
      true,
      false,
    );
    expect(job.fixes.map((fix) => fix.stringId)).toEqual([1]);
    expect(job.advisories).toEqual([]);
  });

  it('keeps rewriting an advisory row while it still has budget', () => {
    const job = buildBatchPersistJob(
      [row({ rewrite_count: 4 })],
      [result({ suggestion: 'Ну що, рушаємо?' })],
      opts,
      true,
      false,
    );
    expect(job.fixes.map((fix) => fix.stringId)).toEqual([1]);
  });

  it('sends a proven gender leak with no wording to the specialist pass', () => {
    const job = build([result({ defects: ['gender_leak'] })]);
    expect(job.genderRepairs.map((r) => r.string_id)).toEqual([1]);
    expect(job.okStringIds).toEqual([]);
    expect(job.advisories).toEqual([]);
  });

  it('does not send a row that already has a wording to apply', () => {
    const job = build([result({ defects: ['gender_leak'], suggestion: 'Ну що, рушаємо?' })], true);
    expect(job.genderRepairs).toEqual([]);
    expect(job.fixes.map((fix) => fix.stringId)).toEqual([1]);
  });

  it('does not send a row blocked by something other than gender', () => {
    const job = build([result({ defects: ['protected_token_mismatch'] })]);
    expect(job.genderRepairs).toEqual([]);
  });

  it('writes nothing on a dry run', () => {
    const job = build([result({ defects: ['gender_leak'] })], false, true);
    expect(job.genderRepairs).toEqual([]);
  });

  const narration = (over: Partial<VerifyStringRow> = {}) =>
    row({ signature: 'TERM', path: 'TERM\UNAM', ...over });

  it('will not block narration on a guessed narrator gender', () => {
    const job = buildBatchPersistJob(
      [narration({ narrator_gender: 'male', narrator_gender_source: 'heuristic' })],
      [result({ defects: ['gender_leak'] })],
      opts,
      false,
      false,
    );
    expect(job.okStringIds).toEqual([1]);
    expect(job.advisories.map((a) => a.stringId)).toEqual([1]);
    expect(job.genderRepairs).toEqual([]);
  });

  it('blocks narration when a person set the narrator gender', () => {
    const job = buildBatchPersistJob(
      [narration({ narrator_gender: 'male', narrator_gender_source: 'manual' })],
      [result({ defects: ['gender_leak'] })],
      opts,
      false,
      false,
    );
    expect(job.okStringIds).toEqual([]);
    expect(job.advisories).toEqual([]);
  });

  it('blocks narration when the gender was overridden by hand', () => {
    const job = buildBatchPersistJob(
      [narration({ narrator_gender: 'male', narrator_gender_override: 'female' })],
      [result({ defects: ['gender_leak'] })],
      opts,
      false,
      false,
    );
    expect(job.okStringIds).toEqual([]);
  });

  it('still blocks a spoken line, whose gender comes from the game data', () => {
    const job = buildBatchPersistJob(
      [row({ narrator_gender_source: 'heuristic' })],
      [result({ defects: ['gender_leak'] })],
      opts,
      false,
      false,
    );
    expect(job.okStringIds).toEqual([]);
    expect(job.advisories).toEqual([]);
  });

  it('keeps another proven defect on the same narration row', () => {
    const job = buildBatchPersistJob(
      [narration({ narrator_gender_source: 'heuristic' })],
      [result({ defects: ['gender_leak', 'protected_token_mismatch'] })],
      opts,
      false,
      false,
    );
    expect(job.okStringIds).toEqual([]);
  });

  it('approves an ok row without recording anything', () => {
    const job = build([result({ verdict: 'ok' })]);
    expect(job.okStringIds).toEqual([1]);
    expect(job.advisories).toEqual([]);
    expect(job.issues).toEqual([]);
  });
});
