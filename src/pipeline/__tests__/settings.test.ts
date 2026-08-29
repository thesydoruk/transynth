import { describe, expect, it } from '@jest/globals';
import {
  clampDependencyWaitTimeoutSec,
  clampHealthCheckIntervalSec,
  DEFAULT_DEPENDENCY_WAIT_TIMEOUT_SEC,
  DEFAULT_HEALTH_CHECK_INTERVAL_SEC,
} from '../settings';

describe('pipeline settings clamps', () => {
  it('clamps wait timeout to 30–7200 seconds', () => {
    expect(clampDependencyWaitTimeoutSec(600)).toBe(600);
    expect(clampDependencyWaitTimeoutSec(10)).toBe(30);
    expect(clampDependencyWaitTimeoutSec(10_000)).toBe(7_200);
    expect(clampDependencyWaitTimeoutSec(Number.NaN)).toBe(DEFAULT_DEPENDENCY_WAIT_TIMEOUT_SEC);
  });

  it('clamps health interval to 1–120 seconds', () => {
    expect(clampHealthCheckIntervalSec(10)).toBe(10);
    expect(clampHealthCheckIntervalSec(0)).toBe(1);
    expect(clampHealthCheckIntervalSec(200)).toBe(120);
    expect(clampHealthCheckIntervalSec(Number.NaN)).toBe(DEFAULT_HEALTH_CHECK_INTERVAL_SEC);
  });
});
