import { describe, expect, it } from '@jest/globals';
import { effectiveEffortTag } from '../../../../voice/voiceEffortStore';
import {
  effortOverrideOfChoice,
  effortTagOfChoice,
  parseVoiceEffortChoice,
  voiceLineEffortOf,
} from '../voiceLineEffort';

describe('voice line effort', () => {
  it('lets a choice win over the derived tag, as the SQL does', () => {
    expect(effectiveEffortTag('shouting', null)).toBe('shouting');
    expect(effectiveEffortTag('shouting', 'none')).toBeNull();
    expect(effectiveEffortTag(null, 'loud')).toBe('loud');
    expect(effectiveEffortTag('loud', 'shouting')).toBe('shouting');
  });

  it('shows the tag in force next to what the analysis said', () => {
    expect(voiceLineEffortOf({ strength: 2.3, tag: 'shouting', override: 'none' })).toEqual({
      effortTag: null,
      effortAutoTag: 'shouting',
      effortOverride: 'none',
      effortStrength: 2.3,
    });
    expect(voiceLineEffortOf(undefined)).toEqual({
      effortTag: null,
      effortAutoTag: null,
      effortOverride: null,
      effortStrength: null,
    });
  });

  it('reads only the four choices from a request', () => {
    expect(parseVoiceEffortChoice('auto')).toBe('auto');
    expect(parseVoiceEffortChoice('shouting')).toBe('shouting');
    expect(parseVoiceEffortChoice('screaming')).toBeNull();
    expect(parseVoiceEffortChoice(undefined)).toBeNull();
  });

  it('makes "auto" mean the derived tag, not the line\'s current choice', () => {
    expect(effortOverrideOfChoice('auto')).toBeNull();
    expect(effortTagOfChoice('auto', 'loud')).toBe('loud');
    expect(effortTagOfChoice('none', 'loud')).toBeNull();
    expect(effortTagOfChoice('shouting', null)).toBe('shouting');
  });
});
