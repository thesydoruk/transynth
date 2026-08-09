import { ukVoiceImportConcurrency } from '../import/importConcurrency';

describe('ukVoiceImportConcurrency', () => {
  it('is at least 4', () => {
    expect(ukVoiceImportConcurrency()).toBeGreaterThanOrEqual(4);
  });
});
