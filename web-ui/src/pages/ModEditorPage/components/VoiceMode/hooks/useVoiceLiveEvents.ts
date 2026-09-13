import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BASE, type VoiceLiveLineEvent } from '../../../../../api';
import type { VoiceSpeakerLinesResponse, VoiceSpeakersResponse } from '../../../../../api';
import {
  applyVoiceLiveLineDone,
  parseVoiceLiveSseEvent,
  voiceLiveLineKey,
} from '../voiceLiveCache';
import { voiceSpeakerLinesQueryKey, voiceSpeakersQueryKey } from './useVoiceData';

const FLASH_MS = 2500;
const STALE_MS = 180_000;

export interface UseVoiceLiveEventsParams {
  modId: number;
  srcLang: string;
  targetLang: string;
}

/** Subscribe to per-line synthesis SSE and patch the voice editor caches. */
export const useVoiceLiveEvents = ({ modId, srcLang, targetLang }: UseVoiceLiveEventsParams) => {
  const qc = useQueryClient();
  const [synthesizingSpeakers, setSynthesizingSpeakers] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [synthesizingLines, setSynthesizingLines] = useState<ReadonlySet<string>>(() => new Set());
  const [flashedSpeakers, setFlashedSpeakers] = useState<ReadonlySet<string>>(() => new Set());
  const [flashedLines, setFlashedLines] = useState<ReadonlySet<string>>(() => new Set());

  const speakerCounts = useRef(new Map<string, number>());
  const activeLines = useRef(new Set<string>());
  const flashTimers = useRef(new Map<string, number>());
  const staleTimers = useRef(new Map<string, number>());

  useEffect(() => {
    const bumpSpeaker = (speakerKey: string, delta: number) => {
      const next = (speakerCounts.current.get(speakerKey) ?? 0) + delta;
      if (next <= 0) speakerCounts.current.delete(speakerKey);
      else speakerCounts.current.set(speakerKey, next);
      setSynthesizingSpeakers(new Set(speakerCounts.current.keys()));
    };

    const clearStale = (lineKey: string) => {
      const timer = staleTimers.current.get(lineKey);
      if (timer != null) {
        window.clearTimeout(timer);
        staleTimers.current.delete(lineKey);
      }
    };

    const finishLine = (event: VoiceLiveLineEvent) => {
      const lineKey = voiceLiveLineKey(event);
      clearStale(lineKey);
      if (!activeLines.current.has(lineKey)) return;
      activeLines.current.delete(lineKey);
      setSynthesizingLines(new Set(activeLines.current));
      bumpSpeaker(event.speakerKey, -1);
    };

    const flash = (event: VoiceLiveLineEvent) => {
      const lineKey = voiceLiveLineKey(event);
      const speakerTimerKey = `speaker:${event.speakerKey}`;
      const lineTimerKey = `line:${lineKey}`;
      setFlashedSpeakers((prev) => new Set(prev).add(event.speakerKey));
      setFlashedLines((prev) => new Set(prev).add(lineKey));

      const restart = (key: string, onClear: () => void) => {
        const existing = flashTimers.current.get(key);
        if (existing != null) window.clearTimeout(existing);
        flashTimers.current.set(
          key,
          window.setTimeout(() => {
            flashTimers.current.delete(key);
            onClear();
          }, FLASH_MS),
        );
      };

      restart(speakerTimerKey, () => {
        setFlashedSpeakers((prev) => {
          if (!prev.has(event.speakerKey)) return prev;
          const next = new Set(prev);
          next.delete(event.speakerKey);
          return next;
        });
      });
      restart(lineTimerKey, () => {
        setFlashedLines((prev) => {
          if (!prev.has(lineKey)) return prev;
          const next = new Set(prev);
          next.delete(lineKey);
          return next;
        });
      });
    };

    const patchDone = (event: VoiceLiveLineEvent) => {
      const speakersKey = voiceSpeakersQueryKey(modId, srcLang, targetLang);
      const linesKey = voiceSpeakerLinesQueryKey(modId, event.speakerKey, srcLang, targetLang);
      const speakers = qc.getQueryData<VoiceSpeakersResponse>(speakersKey);
      const lines = qc.getQueryData<VoiceSpeakerLinesResponse>(linesKey);
      const next = applyVoiceLiveLineDone(speakers, lines, event);
      if (next.speakers !== speakers) qc.setQueryData(speakersKey, next.speakers);
      if (next.lines !== lines) qc.setQueryData(linesKey, next.lines);
    };

    const onEvent = (event: VoiceLiveLineEvent) => {
      if (event.modId !== modId) return;
      const lineKey = voiceLiveLineKey(event);
      if (event.type === 'line_started') {
        if (!activeLines.current.has(lineKey)) {
          activeLines.current.add(lineKey);
          setSynthesizingLines(new Set(activeLines.current));
          bumpSpeaker(event.speakerKey, 1);
        }
        clearStale(lineKey);
        staleTimers.current.set(
          lineKey,
          window.setTimeout(() => {
            finishLine(event);
          }, STALE_MS),
        );
        return;
      }
      finishLine(event);
      if (event.type === 'line_done') {
        patchDone(event);
        flash(event);
      }
    };

    const source = new EventSource(`${BASE}/api/mods/${modId}/voice/live`);
    source.onmessage = (message) => {
      const parsed = parseVoiceLiveSseEvent(message.data);
      if (!parsed || parsed.type === 'ping') return;
      onEvent(parsed);
    };

    return () => {
      source.close();
      for (const timer of flashTimers.current.values()) window.clearTimeout(timer);
      for (const timer of staleTimers.current.values()) window.clearTimeout(timer);
      flashTimers.current.clear();
      staleTimers.current.clear();
      speakerCounts.current.clear();
      activeLines.current.clear();
    };
  }, [modId, qc, srcLang, targetLang]);

  return { synthesizingSpeakers, synthesizingLines, flashedSpeakers, flashedLines };
};
