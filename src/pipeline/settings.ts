/** Defaults and clamps for pipeline dependency-wait project settings. */

export const DEFAULT_DEPENDENCY_WAIT_TIMEOUT_SEC = 600;
export const DEFAULT_HEALTH_CHECK_INTERVAL_SEC = 10;

export const MIN_DEPENDENCY_WAIT_TIMEOUT_SEC = 30;
export const MAX_DEPENDENCY_WAIT_TIMEOUT_SEC = 7_200;
export const MIN_HEALTH_CHECK_INTERVAL_SEC = 1;
export const MAX_HEALTH_CHECK_INTERVAL_SEC = 120;

const clampInt = (value: number, min: number, max: number, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
};

/** How long a job waits for LLM/TTS to become healthy (30s–2h). */
export const clampDependencyWaitTimeoutSec = (value: number): number =>
  clampInt(
    value,
    MIN_DEPENDENCY_WAIT_TIMEOUT_SEC,
    MAX_DEPENDENCY_WAIT_TIMEOUT_SEC,
    DEFAULT_DEPENDENCY_WAIT_TIMEOUT_SEC,
  );

/** Pause between failed health probes (1–120s). */
export const clampHealthCheckIntervalSec = (value: number): number =>
  clampInt(
    value,
    MIN_HEALTH_CHECK_INTERVAL_SEC,
    MAX_HEALTH_CHECK_INTERVAL_SEC,
    DEFAULT_HEALTH_CHECK_INTERVAL_SEC,
  );
