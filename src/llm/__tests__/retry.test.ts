import { describe, expect, it } from '@jest/globals';
import { isAbortError, isLlmTimeoutError } from '../retry';

describe('isAbortError', () => {
  it('recognizes AbortError / APIUserAbortError / ABORT_ERR', () => {
    expect(isAbortError(Object.assign(new Error('boom'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortError(Object.assign(new Error('boom'), { name: 'APIUserAbortError' }))).toBe(
      true,
    );
    expect(isAbortError(Object.assign(new Error('boom'), { code: 'ABORT_ERR' }))).toBe(true);
  });

  it('recognizes the plain vLLM abort message', () => {
    expect(isAbortError(new Error('Request was aborted.'))).toBe(true);
  });

  it('does not treat timeouts as user abort', () => {
    const timeout = Object.assign(new Error('Request timed out.'), {
      name: 'APIConnectionTimeoutError',
    });
    expect(isAbortError(timeout)).toBe(false);
    expect(isLlmTimeoutError(timeout)).toBe(true);
  });
});
