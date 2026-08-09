import { f0Distance } from '../f0Distance';

describe('f0Distance', () => {
  it('returns absolute Hz difference when both values exist', () => {
    expect(f0Distance(120, 100)).toBe(20);
    expect(f0Distance(100, 120)).toBe(20);
  });

  it('uses a soft penalty when either side is missing', () => {
    expect(f0Distance(null, 120)).toBe(25);
    expect(f0Distance(120, null)).toBe(25);
    expect(f0Distance(null, null)).toBe(25);
  });
});
