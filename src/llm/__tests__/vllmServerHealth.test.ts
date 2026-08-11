import { describe, it, expect, jest, afterEach } from '@jest/globals';
import {
  isVllmConnectionError,
  NoHealthyVllmServerError,
  probeVllmServerHealth,
} from '../vllmServerHealth';

describe('vllmServerHealth', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('detects connection-style errors', () => {
    expect(isVllmConnectionError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(
      true,
    );
    expect(isVllmConnectionError(Object.assign(new Error('x'), { status: 503 }))).toBe(true);
    expect(isVllmConnectionError(new Error('validation failed'))).toBe(false);
  });

  it('probes /v1/models and treats non-OK as unhealthy', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    } as Response);
    await expect(probeVllmServerHealth('http://host:8000', '', 1000)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://host:8000/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns true for OK probe responses', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response);
    await expect(probeVllmServerHealth('http://host:8000/v1', 'secret', 1000)).resolves.toBe(true);
  });

  it('NoHealthyVllmServerError is a 503 availability error', () => {
    const err = new NoHealthyVllmServerError(['http://a', 'http://b']);
    expect(err.status).toBe(503);
    expect(err.message).toContain('http://a');
  });
});
