import { describe, expect, it } from 'vitest';
import type { VoiceLinePreview, VoiceSpeakerSummary } from '../../../../../api';
import {
  applyVoiceLiveLineDone,
  parseVoiceLiveSseEvent,
  voiceLiveLineKey,
} from '../voiceLiveCache';

const speaker = (partial: Partial<VoiceSpeakerSummary> = {}): VoiceSpeakerSummary => ({
  key: 'MaleBoston',
  displayName: 'Male Boston',
  referencePick: null,
  gender: 'male',
  genderMismatch: false,
  lineCount: 4,
  dubbedCount: 1,
  orphanCount: 0,
  ...partial,
});

const line = (partial: Partial<VoiceLinePreview> = {}): VoiceLinePreview => ({
  formidLower6: '000001',
  infoFormidHex: '00000001',
  variant: 1,
  fileName: '00000001_1.fuz',
  speakerKey: 'MaleBoston',
  stringId: 10,
  translationId: 3,
  status: 'draft',
  source: 'Hello',
  translation: 'Привіт',
  isReference: false,
  isInheritedAudio: false,
  inheritedFrom: null,
  isOrphanAudio: false,
  hasTranslationAudio: false,
  canGenerateVoice: true,
  ttsSkipReason: null,
  voiceSimilarity: null,
  ...partial,
});

describe('parseVoiceLiveSseEvent', () => {
  it('reads line events and ignores pings', () => {
    expect(parseVoiceLiveSseEvent(JSON.stringify({ type: 'ping' }))).toEqual({ type: 'ping' });
    expect(
      parseVoiceLiveSseEvent(
        JSON.stringify({
          type: 'line_started',
          modId: 2,
          speakerKey: 'MaleBoston',
          formidLower6: '000001',
          variant: 1,
        }),
      ),
    ).toMatchObject({ type: 'line_started', speakerKey: 'MaleBoston' });
    expect(parseVoiceLiveSseEvent('not-json')).toBeNull();
  });
});

describe('applyVoiceLiveLineDone', () => {
  const event = {
    type: 'line_done' as const,
    modId: 2,
    speakerKey: 'MaleBoston',
    formidLower6: '000001',
    variant: 1,
    voiceSimilarity: 0.91,
  };

  it('marks the matching row dubbed and bumps the speaker count', () => {
    const next = applyVoiceLiveLineDone(
      { ok: true, speakers: [speaker()], totalLines: 4 },
      { ok: true, speakerKey: 'MaleBoston', lines: [line()] },
      event,
    );
    expect(next.lines?.ok && next.lines.lines[0]?.hasTranslationAudio).toBe(true);
    expect(next.lines?.ok && next.lines.lines[0]?.voiceSimilarity).toBe(0.91);
    expect(next.speakers?.ok && next.speakers.speakers[0]?.dubbedCount).toBe(2);
  });

  it('does not increment again when the row was already dubbed', () => {
    const next = applyVoiceLiveLineDone(
      { ok: true, speakers: [speaker({ dubbedCount: 2 })], totalLines: 4 },
      { ok: true, speakerKey: 'MaleBoston', lines: [line({ hasTranslationAudio: true })] },
      event,
    );
    expect(next.speakers?.ok && next.speakers.speakers[0]?.dubbedCount).toBe(2);
  });

  it('still bumps the speaker when that character is not the open list', () => {
    const next = applyVoiceLiveLineDone(
      { ok: true, speakers: [speaker()], totalLines: 4 },
      undefined,
      event,
    );
    expect(next.speakers?.ok && next.speakers.speakers[0]?.dubbedCount).toBe(2);
  });
});

describe('voiceLiveLineKey', () => {
  it('matches the editor row key', () => {
    expect(voiceLiveLineKey({ speakerKey: 'Nora', formidLower6: 'aa', variant: 2 })).toBe(
      'Nora:aa:2',
    );
  });
});
