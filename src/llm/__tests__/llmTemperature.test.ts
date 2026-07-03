import { describe, expect, it } from '@jest/globals';
import { resolveLlmChatTemperature } from '../index';

describe('resolveLlmChatTemperature', () => {
  it('decreases linearly and floors at zero', () => {
    // Uses CONFIG defaults: base 0.7, decay 0.02
    expect(resolveLlmChatTemperature(0)).toBeCloseTo(0.7);
    expect(resolveLlmChatTemperature(1)).toBeCloseTo(0.68);
    expect(resolveLlmChatTemperature(35)).toBe(0);
    expect(resolveLlmChatTemperature(100)).toBe(0);
  });
});
