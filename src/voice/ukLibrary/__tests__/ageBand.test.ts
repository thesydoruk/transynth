import { ageDistance, inferCharacterAge, parseCvAge } from '../ageBand';

describe('parseCvAge', () => {
  it('normalizes CV labels', () => {
    expect(parseCvAge('twenties')).toBe('twenties');
    expect(parseCvAge('forties')).toBe('fourties');
    expect(parseCvAge('')).toBe('unknown');
  });
});

describe('inferCharacterAge', () => {
  it('detects child and elder folders', () => {
    expect(inferCharacterAge('MaleChild')).toBe('teens');
    expect(inferCharacterAge('NPCMElderly')).toBe('sixties');
    expect(inferCharacterAge('MaleEvenToned')).toBe('thirties');
  });
});

describe('ageDistance', () => {
  it('is zero for same band', () => {
    expect(ageDistance('thirties', 'thirties')).toBe(0);
    expect(ageDistance('twenties', 'fourties')).toBe(2);
  });
});
