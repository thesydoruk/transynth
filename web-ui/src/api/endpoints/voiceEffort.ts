import { req } from '../client';
import type { VoiceEffortChoice, VoiceLineEffort, VoiceLinePreview } from '../types';

export const voiceEffortEndpoints = {
  /** Set a person's effort tag for one take; 'auto' hands it back to the analysis. */
  setOverride: (
    modId: number,
    line: Pick<VoiceLinePreview, 'speakerKey' | 'lineKey' | 'variant' | 'originPlugin'>,
    choice: VoiceEffortChoice,
  ) =>
    req<{ ok: true } & VoiceLineEffort>(`/api/mods/${modId}/voice/effort-override`, {
      method: 'PUT',
      body: JSON.stringify({
        speakerKey: line.speakerKey,
        lineKey: line.lineKey,
        variant: line.variant,
        originPlugin: line.originPlugin ?? null,
        choice,
      }),
    }),
};
