import fs from 'node:fs';
import path from 'node:path';
import { resolveAudioIntelBaseUrl } from './baseUrl';
import type { AudioIntelSpeechSegment, AudioIntelTranscript } from './types';

export type TranscribeWavOptions = {
  baseUrl?: string;
  language?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type RawSegment = {
  kind?: string;
  start?: number;
  end?: number;
  text?: string;
  confidence?: number | null;
};

const asFinite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const parseSpeechSegments = (raw: unknown): AudioIntelSpeechSegment[] => {
  if (!Array.isArray(raw)) return [];
  const segments: AudioIntelSpeechSegment[] = [];
  for (const entry of raw as RawSegment[]) {
    if (entry?.kind && entry.kind !== 'speech') continue;
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    if (!text) continue;
    segments.push({
      start: asFinite(entry.start) ?? 0,
      end: asFinite(entry.end) ?? 0,
      text,
      confidence: asFinite(entry.confidence),
    });
  }
  return segments;
};

export const parseAudioIntelTranscript = (body: unknown): AudioIntelTranscript => {
  const row = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const segments = parseSpeechSegments(row.segments);
  const text =
    typeof row.text === 'string' && row.text.trim()
      ? row.text.trim()
      : segments
          .map((s) => s.text)
          .join(' ')
          .trim();
  return {
    text,
    confidence: asFinite(row.confidence),
    duration: asFinite(row.duration),
    language: typeof row.language === 'string' ? row.language : null,
    segments,
  };
};

/** One WAV → Whisper transcript (`POST /v1/audio/transcriptions`). */
export const transcribeWav = async (
  wavPath: string,
  options: TranscribeWavOptions = {},
): Promise<AudioIntelTranscript> => {
  const root = (options.baseUrl ?? resolveAudioIntelBaseUrl()).replace(/\/$/, '');
  const bytes = fs.readFileSync(wavPath);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'audio/wav' }), path.basename(wavPath));
  form.append('language', options.language ?? 'en');
  form.append('response_format', 'verbose_json');

  const timeoutMs = options.timeoutMs ?? 120_000;
  const response = await fetch(`${root}/v1/audio/transcriptions`, {
    method: 'POST',
    body: form,
    signal: options.signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `audio-intel transcribe failed (${response.status} ${root}/v1/audio/transcriptions)${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
  return parseAudioIntelTranscript(await response.json());
};
