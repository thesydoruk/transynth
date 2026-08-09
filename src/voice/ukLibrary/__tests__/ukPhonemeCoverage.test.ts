import { pickAnalyzeCandidates, type ClipCandidate } from '../import/clipCandidates';
import {
  blendUkReferenceScore,
  scoreUkPhonemeCoverage,
  UK_PHONEME_QUALITY_BONUS_MAX,
  ukPhonemeQualityBonus,
} from '../import/ukPhonemeCoverage';

describe('scoreUkPhonemeCoverage', () => {
  it('scores higher when transcript has rolled р and other UK letters', () => {
    const plain = scoreUkPhonemeCoverage('Це просто якась коротка фраза без характерних літер.');
    // "просто"/"фраза" still have р — use a deliberately р-poor control
    const poor = scoreUkPhonemeCoverage('Однак село таке тихе, коли люди сидять удома.');
    const rich = scoreUkPhonemeCoverage(
      'Гріє річка, їжак і ґава щебечуть; є радість у щирих розмовах.',
    );
    expect(rich).toBeGreaterThan(poor);
    expect(rich).toBeGreaterThan(0.5);
    expect(plain).toBeGreaterThan(0);
  });

  it('returns 0 for tiny strings', () => {
    expect(scoreUkPhonemeCoverage('ріка')).toBe(0);
  });
});

describe('ukPhonemeQualityBonus', () => {
  it('never exceeds the quality bonus cap', () => {
    const bonus = ukPhonemeQualityBonus(
      'Три річки, їжак, єнот і ґава — щирий приклад розгорнутої фрази.',
    );
    expect(bonus).toBeGreaterThan(0);
    expect(bonus).toBeLessThanOrEqual(UK_PHONEME_QUALITY_BONUS_MAX);
  });

  it('cannot overturn a much better acoustic score', () => {
    const weakRich = blendUkReferenceScore(70, 'Три річки їжак є ґава щирі розмови пара.');
    const strongPoor = blendUkReferenceScore(85, 'Однак село таке тихе, коли люди сидять удома.');
    expect(strongPoor).toBeGreaterThan(weakRich);
  });
});

describe('pickAnalyzeCandidates phoneme preference', () => {
  it('prefers similar-duration clips with richer Ukrainian phonemes', () => {
    const candidates: ClipCandidate[] = [
      {
        id: 'poor',
        audioPath: 'a',
        durationSec: 6,
        transcript: 'Однак село таке тихе, коли люди сидять удома.',
        upVotes: 10,
      },
      {
        id: 'rich',
        audioPath: 'b',
        durationSec: 6.1,
        transcript: 'Гріє річка, їжак і ґава щебечуть; є радість у щирих розмовах.',
        upVotes: 1,
      },
    ];
    expect(pickAnalyzeCandidates(candidates)[0]?.id).toBe('rich');
  });
});
