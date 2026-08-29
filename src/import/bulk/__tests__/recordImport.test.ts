import { recordTranslationMeta } from '../recordImport';

describe('recordTranslationMeta', () => {
  it('maps confirmed status 0x63 to human with confidence 1.0', () => {
    expect(recordTranslationMeta(0x63)).toEqual({ status: 'human', confidence: 1.0 });
  });

  it('maps other status bytes to auto with confidence 0.5', () => {
    expect(recordTranslationMeta(0xff)).toEqual({ status: 'auto', confidence: 0.5 });
    expect(recordTranslationMeta(0)).toEqual({ status: 'auto', confidence: 0.5 });
  });
});
