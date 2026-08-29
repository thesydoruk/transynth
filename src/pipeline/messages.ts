import type { DependencyService } from './errors';

const serviceLabel = (service: DependencyService): string => (service === 'llm' ? 'LLM' : 'TTS');

export const formatDependencyWaitFailed = (args: {
  service: DependencyService;
  spentAttempts: number;
  remainingAttempts: number;
  error: string;
}): string =>
  `${serviceLabel(args.service)} health check failed (spent ${args.spentAttempts}, remaining ${args.remainingAttempts}): ${args.error}`;

export const formatDependencyWaitRecovered = (args: {
  service: DependencyService;
  spentAttempts: number;
}): string =>
  `${serviceLabel(args.service)} is healthy again after ${args.spentAttempts} failed health checks`;

export const formatDependencyWaitExhausted = (args: {
  service: DependencyService;
  spentAttempts: number;
  timeoutSec: number;
  error: string;
}): string =>
  `${serviceLabel(args.service)} still unavailable after ${args.spentAttempts} health checks (${args.timeoutSec}s): ${args.error}`;
