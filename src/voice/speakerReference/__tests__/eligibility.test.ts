import { voiceTranslationMapKey, type VoiceSourceRow } from '../../loadVoiceTranslations';
import {
  MANUAL_REFERENCE_FORMID,
  anyVoiceReferenceEligible,
  isManualVoiceReferencePick,
  isVoiceReferencePickEligible,
  voiceReferenceEligibilityFromSources,
} from '../eligibility';

const sources = new Map<string, VoiceSourceRow>([
  [voiceTranslationMapKey('002CBA', 1), { source: 'Hello there.' }],
  [voiceTranslationMapKey('002CBA', 2), { source: 'Second take.' }],
]);

describe('voiceReferenceEligibilityFromSources', () => {
  const isEligible = voiceReferenceEligibilityFromSources(sources);

  it('accepts clips whose own line text is known', () => {
    expect(isEligible('002CBA', 1)).toBe(true);
    expect(isEligible('002cba', 2)).toBe(true);
  });

  it('rejects orphan audio and variants without text', () => {
    expect(isEligible('002D79', 1)).toBe(false);
    expect(isEligible('002CBA', 3)).toBe(false);
  });
});

describe('isVoiceReferencePickEligible', () => {
  const isEligible = voiceReferenceEligibilityFromSources(sources);

  it('keeps a hand-placed reference regardless of dialogue text', () => {
    const pick = { formidLower6: MANUAL_REFERENCE_FORMID, variant: 1 };
    expect(isManualVoiceReferencePick(pick)).toBe(true);
    expect(isVoiceReferencePickEligible(pick, isEligible)).toBe(true);
  });

  it('drops a saved pick that has no dialogue text', () => {
    expect(isVoiceReferencePickEligible({ formidLower6: '002D79', variant: 1 }, isEligible)).toBe(
      false,
    );
    expect(isVoiceReferencePickEligible({ formidLower6: '002CBA', variant: 1 }, isEligible)).toBe(
      true,
    );
  });

  it('accepts everything when no filter is configured', () => {
    expect(
      isVoiceReferencePickEligible(
        { formidLower6: '002D79', variant: 1 },
        anyVoiceReferenceEligible,
      ),
    ).toBe(true);
  });
});
