import { SERVICE_LABELS, type ServiceKind } from '../services/kinds';

/** A service a job may have to wait for; every registry kind can be one. */
export type DependencyService = ServiceKind;

/** Thrown when LLM or TTS stays unhealthy for the full wait window. */
export class DependencyUnavailableError extends Error {
  readonly service: DependencyService;
  readonly spentAttempts: number;

  constructor(service: DependencyService, spentAttempts: number, lastError: string) {
    super(
      `${SERVICE_LABELS[service]} still unavailable after ${spentAttempts} health checks: ${lastError}`,
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
