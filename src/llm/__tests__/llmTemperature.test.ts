import { describe, expect, it } from '@jest/globals';
import { resolveLlmChatTemperature } from '../index';

describe('resolveLlmChatTemperature', () => {
  it('decreases linearly and floors at zero', () => {
    // Uses CONFIG defaults: base 0.3, decay 0.02
    expect(resolveLlmChatTemperature(0)).toBeCloseTo(0.3);
    expect(resolveLlmChatTemperature(1)).toBeCloseTo(0.28);
    expect(resolveLlmChatTemperature(15)).toBe(0);
    expect(resolveLlmChatTemperature(100)).toBe(0);
  });
});
