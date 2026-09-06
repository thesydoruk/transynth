import { describe, it, expect } from '@jest/globals';
import { IMAGE_CHAMPOLLION_PATH, resolveChampollionPath } from '../champollionPath';

describe('resolveChampollionPath', () => {
  it('always uses the image binary', () => {
    expect(resolveChampollionPath()).toBe(IMAGE_CHAMPOLLION_PATH);
  });
});
