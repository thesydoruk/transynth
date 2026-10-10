import { describe, expect, it } from '@jest/globals';
import { parseRouteId } from '../parseRouteId';

describe('parseRouteId', () => {
  it('reads a positive integer', () => {
    expect(parseRouteId('1')).toBe(1);
    expect(parseRouteId('42')).toBe(42);
  });

  it.each(['abc', '', '0', '-1', '1.5', 'NaN', 'Infinity'])('rejects %p', (raw) => {
    expect(parseRouteId(raw)).toBeNull();
  });
});
