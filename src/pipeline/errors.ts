export type DependencyService = 'llm' | 'tts';

/** Thrown when LLM or TTS stays unhealthy for the full wait window. */
export class DependencyUnavailableError extends Error {
  readonly service: DependencyService;
  readonly spentAttempts: number;

  constructor(service: DependencyService, spentAttempts: number, lastError: string) {
    super(
      `${service === 'llm' ? 'LLM' : 'TTS'} still unavailable after ${spentAttempts} health checks: ${lastError}`,
    );
    this.name = 'DependencyUnavailableError';
    this.service = service;
    this.spentAttempts = spentAttempts;
  }
}

export const isDependencyUnavailableError = (err: unknown): err is DependencyUnavailableError => {
  if (err instanceof DependencyUnavailableError) return true;
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'DependencyUnavailableError'
  );
};
