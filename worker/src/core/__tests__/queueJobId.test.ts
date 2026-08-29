import { fromBullJobId, toBullJobId } from '../jobId';

describe('bull job id mapping', () => {
  it('prefixes numeric ids for BullMQ', () => {
    expect(toBullJobId(42)).toBe('job-42');
  });

  it('parses prefixed and legacy plain ids', () => {
    expect(fromBullJobId('job-42')).toBe(42);
    expect(fromBullJobId('7')).toBe(7);
    expect(fromBullJobId('job-')).toBeNull();
    expect(fromBullJobId(undefined)).toBeNull();
  });
});
