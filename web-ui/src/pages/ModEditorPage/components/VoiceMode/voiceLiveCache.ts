import type {
  VoiceLinePreview,
  VoiceLiveLineEvent,
  VoiceLiveSseEvent,
  VoiceSpeakerLinesResponse,
  VoiceSpeakersResponse,
} from '../../../../api';

const isLineEvent = (value: VoiceLiveSseEvent): value is VoiceLiveLineEvent =>
  value.type === 'line_started' || value.type === 'line_done' || value.type === 'line_failed';

export const parseVoiceLiveSseEvent = (raw: string): VoiceLiveSseEvent | null => {
  try {
    const value = JSON.parse(raw) as VoiceLiveSseEvent;
    if (!value || typeof value !== 'object' || !('type' in value)) return null;
    if (value.type === 'ping') return value;
    if (!isLineEvent(value)) return null;
    if (!value.speakerKey || !value.lineKey) return null;
    if (!Number.isInteger(value.variant) || value.variant < 1) return null;
    return value;
  } catch {
    return null;
  }
};

export const voiceLiveLineKey = (event: {
  speakerKey: string;
  lineKey: string;
  variant: number;
}): string => `${event.speakerKey}:${event.lineKey}:${event.variant}`;

const sameLine = (
  line: VoiceLinePreview,
  event: Pick<VoiceLiveLineEvent, 'speakerKey' | 'lineKey' | 'variant'>,
): boolean =>
  line.speakerKey === event.speakerKey &&
  line.lineKey.toLowerCase() === event.lineKey.toLowerCase() &&
  line.variant === event.variant;

export const applyVoiceLiveLineDone = (
  speakers: VoiceSpeakersResponse | undefined,
  lines: VoiceSpeakerLinesResponse | undefined,
  event: VoiceLiveLineEvent,
): {
  speakers: VoiceSpeakersResponse | undefined;
  lines: VoiceSpeakerLinesResponse | undefined;
} => {
  let alreadyDubbed = false;
  let nextLines = lines;
  if (lines?.ok) {
    nextLines = {
      ...lines,
      lines: lines.lines.map((line) => {
        if (!sameLine(line, event)) return line;
        alreadyDubbed = line.hasTranslationAudio;
        return {
          ...line,
          hasTranslationAudio: true,
          voiceSimilarity: event.voiceSimilarity ?? line.voiceSimilarity,
        };
      }),
    };
  }

  if (alreadyDubbed || !speakers?.ok) {
    return { speakers, lines: nextLines };
  }

  return {
    speakers: {
      ...speakers,
      speakers: speakers.speakers.map((speaker) =>
        speaker.key === event.speakerKey
          ? { ...speaker, dubbedCount: speaker.dubbedCount + 1 }
          : speaker,
      ),
    },
    lines: nextLines,
  };
};
