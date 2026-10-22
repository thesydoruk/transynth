/**
 * Clone similarity of a finished take, scored by the Fish Speech gateway.
 *
 * A synthesis answers with `X-Voice-Similarity` (see `ttsClient.ts`); this asks the
 * gateway's `POST /v1/similarity` for the same number about audio that already exists,
 * so takes made while the gateway's voice gate was off can be stamped after the fact.
 * The references are sent exactly as they were for synthesis: the gateway concatenates
 * several clips into one prompt before embedding, as `synthesize` does.
 */
export type TtsSimilarityReference = { wav: Buffer };

export const parseSimilarityResponse = (body: unknown): number | null => {
  if (!body || typeof body !== 'object') return null;
  const value = (body as { voice_similarity?: unknown }).voice_similarity;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const scoreVoiceSimilarity = async (
  baseUrl: string,
  takeWav: Buffer,
  references: TtsSimilarityReference[],
  options: { signal?: AbortSignal } = {},
): Promise<number | null> => {
  if (references.length === 0) throw new Error('Reference audio is empty');
  const form = new FormData();
  form.append('audio', new Blob([takeWav], { type: 'audio/wav' }), 'take.wav');
  references.forEach((clip, index) => {
    form.append('speaker_wav', new Blob([clip.wav], { type: 'audio/wav' }), `speaker-${index}.wav`);
  });
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/similarity`, {
    method: 'POST',
    body: form,
    signal: options.signal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `TTS similarity failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }
  return parseSimilarityResponse(await response.json());
};
